from flask import Flask, request, jsonify, session, redirect
from flask_sqlalchemy import SQLAlchemy
from flask_session import Session
from datetime import datetime, timedelta
import os
import requests
from urllib.parse import urlencode
import secrets
import logging
from dotenv import load_dotenv
import json

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 从环境变量获取配置
load_dotenv()
# 配置
app.config['SECRET_KEY'] = os.urandom(24)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///oauth_sessions.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SESSION_TYPE'] = 'sqlalchemy'
app.config['SESSION_PERMANENT'] = False
app.config['SESSION_USE_SIGNER'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

db = SQLAlchemy(app)
app.config['SESSION_SQLALCHEMY'] = db

Session(app)

# OAuth2 参数
CLIENT_ID = os.getenv('OAUTH_CLIENT_ID')
CLIENT_SECRET = os.getenv('OAUTH_CLIENT_SECRET')
REDIRECT_URI = os.getenv('OAUTH_REDIRECT_URI')
AUTHORIZATION_ENDPOINT = os.getenv('OAUTH_AUTHORIZATION_ENDPOINT')
TOKEN_ENDPOINT = os.getenv('OAUTH_TOKEN_ENDPOINT')
USER_ENDPOINT = os.getenv('OAUTH_USER_ENDPOINT')

# OAuthState 模型
class OAuthState(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    state = db.Column(db.String(50), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __init__(self, state):
        self.state = state

# UserSession 模型
class UserSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(100), unique=True, nullable=False)
    access_token = db.Column(db.String(500), nullable=False)
    refresh_token = db.Column(db.String(500))
    token_expiry = db.Column(db.DateTime, nullable=False)
    user_info = db.Column(db.Text)  # 存储为 JSON 字符串
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

with app.app_context():
    db.create_all()

@app.route('/oauth2/initiate')
def initiate_oauth():
    state = secrets.token_urlsafe(16)
    new_state = OAuthState(state=state)
    db.session.add(new_state)
    db.session.commit()

    params = {
        'client_id': CLIENT_ID,
        'redirect_uri': REDIRECT_URI,
        'response_type': 'code',
        'state': state,
        'scope': 'read'
    }
    auth_url = f"{AUTHORIZATION_ENDPOINT}?{urlencode(params)}"
    return jsonify({"auth_url": auth_url})

@app.route('/oauth2/callback')
def callback():
    code = request.args.get('code')
    state = request.args.get('state')
    logger.debug(f"Received callback with code: {code} and state: {state}")

    # 验证状态
    db_state = OAuthState.query.filter_by(state=state).first()
    if not db_state:
        logger.warning("State value not found or expired")
        return jsonify({"error": "状态值不匹配或已过期"}), 401

    # 删除已使用的状态
    db.session.delete(db_state)
    db.session.commit()

    # 请求token
    auth = requests.auth.HTTPBasicAuth(CLIENT_ID, CLIENT_SECRET)
    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': REDIRECT_URI
    }
    headers = {'Accept': 'application/json'}
    logger.debug(f"Requesting token with data: {data}")
    response = requests.post(TOKEN_ENDPOINT, auth=auth, data=data, headers=headers)
    logger.debug(f"Token response status: {response.status_code}")

    if response.status_code == 200:
        token_data = response.json()
        access_token = token_data['access_token']
        refresh_token = token_data.get('refresh_token')
        expires_in = token_data.get('expires_in', 3600)
        
        user_response = requests.get(USER_ENDPOINT, headers={'Authorization': f"Bearer {access_token}"})
        if user_response.status_code == 200:
            user_info = user_response.json()
            user_id = str(user_info.get('id'))  # 确保 user_id 是字符串

            # 存储或更新用户会话
            user_session = UserSession.query.filter_by(user_id=user_id).first()
            if user_session:
                user_session.access_token = access_token
                user_session.refresh_token = refresh_token
                user_session.token_expiry = datetime.utcnow() + timedelta(seconds=expires_in)
                user_session.user_info = json.dumps(user_info)
            else:
                user_session = UserSession(
                    user_id=user_id,
                    access_token=access_token,
                    refresh_token=refresh_token,
                    token_expiry=datetime.utcnow() + timedelta(seconds=expires_in),
                    user_info=json.dumps(user_info)
                )
                db.session.add(user_session)
            
            db.session.commit()

            # 向程序服务发送认证成功结果
            program_service_url = os.getenv('PROGRAM_SERVICE_URL', 'http://localhost:8080/auth/result')
            auth_result = {
                'user_id': user_id,
                'auth_status': 'success'
            }
        else:
            # 向程序服务发送认证失败结果
            program_service_url = os.getenv('PROGRAM_SERVICE_URL', 'http://localhost:8080/auth/result')
            auth_result = {
                'auth_status': 'error',
                'error_message': '获取用户信息失败'
            }
    else:
        # 向程序服务发送获取访问令牌失败的结果
        program_service_url = os.getenv('PROGRAM_SERVICE_URL', 'http://localhost:8080/auth/result')
        auth_result = {
            'auth_status': 'error',
            'error_message': '获取访问令牌失败'
        }

    # 发送结果给程序服务
    program_response = requests.post(program_service_url, json=auth_result)
    
    if program_response.status_code == 200:
        # 程序服务成功处理了认证结果
        return jsonify({'message': '认证结果已发送至程序服务'}), 200
    else:
        # 程序服务处理失败
        return jsonify({'error': '程序服务处理认证结果失败'}), 500

@app.route('/oauth2/refresh', methods=['POST'])
def refresh_token():
    refresh_token = request.json.get('refresh_token')
    if not refresh_token:
        return jsonify({"error": "No refresh token provided"}), 400

    auth = requests.auth.HTTPBasicAuth(CLIENT_ID, CLIENT_SECRET)
    data = {
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token
    }
    headers = {'Accept': 'application/json'}
    response = requests.post(TOKEN_ENDPOINT, auth=auth, data=data, headers=headers)

    if response.status_code == 200:
        token_data = response.json()
        return jsonify(token_data)
    return jsonify({"error": "Failed to refresh token"}), response.status_code

@app.route('/oauth2/validate', methods=['POST'])
def validate_token():
    user_id = request.json.get('user_id')
    if not user_id:
        return jsonify({"error": "No user ID provided"}), 400

    user_session = UserSession.query.filter_by(user_id=user_id).first()
    if not user_session:
        return jsonify({"valid": False, "error": "User session not found"}), 401

    if datetime.utcnow() > user_session.token_expiry:
        # Token has expired, attempt to refresh
        if user_session.refresh_token:
            new_token_data = refresh_token(user_session.refresh_token)
            if new_token_data:
                user_session.access_token = new_token_data['access_token']
                user_session.refresh_token = new_token_data.get('refresh_token', user_session.refresh_token)
                user_session.token_expiry = datetime.utcnow() + timedelta(seconds=new_token_data.get('expires_in', 3600))
                db.session.commit()
            else:
                return jsonify({"valid": False, "error": "Token expired and refresh failed"}), 401
        else:
            return jsonify({"valid": False, "error": "Token expired and no refresh token available"}), 401

    return jsonify({"valid": True, "user_info": json.loads(user_session.user_info)})

@app.route('/oauth2/logout', methods=['POST'])
def logout():
    user_id = request.json.get('user_id')
    if not user_id:
        return jsonify({"error": "No user ID provided"}), 400

    user_session = UserSession.query.filter_by(user_id=user_id).first()
    if user_session:
        db.session.delete(user_session)
        db.session.commit()

    return jsonify({"message": "Logged out successfully"})

def cleanup_expired_states():
    expiration_time = datetime.utcnow() - timedelta(minutes=5)
    OAuthState.query.filter(OAuthState.created_at < expiration_time).delete()
    db.session.commit()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=25002)
