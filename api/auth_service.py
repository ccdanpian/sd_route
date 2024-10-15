from flask import Flask, request, jsonify, redirect
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta, timezone
import os
import requests
from urllib.parse import urlencode
import secrets
import logging
from dotenv import load_dotenv
import json

# 加载环境变量
load_dotenv()

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 数据库配置
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///oauth_sessions.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# OAuth2 配置
CLIENT_ID = os.getenv('OAUTH_CLIENT_ID')
CLIENT_SECRET = os.getenv('OAUTH_CLIENT_SECRET')
REDIRECT_URI = os.getenv('OAUTH_REDIRECT_URI')
AUTHORIZATION_ENDPOINT = os.getenv('OAUTH_AUTHORIZATION_ENDPOINT')
TOKEN_ENDPOINT = os.getenv('OAUTH_TOKEN_ENDPOINT')
USER_ENDPOINT = os.getenv('OAUTH_USER_ENDPOINT')
PROGRAM_SERVICE_URL = os.getenv('PROGRAM_SERVICE_URL')

# 模型定义
class OAuthState(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    state = db.Column(db.String(50), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now(timezone.utc))

class UserSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(100), unique=True, nullable=False)
    access_token = db.Column(db.String(500), nullable=False)
    refresh_token = db.Column(db.String(500))
    token_expiry = db.Column(db.DateTime, nullable=False)
    user_info = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))

class TempToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    token = db.Column(db.String(100), unique=True, nullable=False)
    user_id = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now(timezone.utc))

with app.app_context():
    db.create_all()

@app.route('/oauth/authorize')
def authorize():
    state = secrets.token_urlsafe(16)
    new_state = OAuthState(state=state)
    db.session.add(new_state)
    db.session.commit()
    logger.info(f"创建新的OAuth状态: {state}")

    params = {
        'client_id': CLIENT_ID,
        'redirect_uri': REDIRECT_URI,
        'response_type': 'code',
        'state': state,
        'scope': 'read'
    }
    auth_url = f"{AUTHORIZATION_ENDPOINT}?{urlencode(params)}"
    logger.info(f"生成授权URL: {auth_url}")
    return jsonify({"auth_url": auth_url, "state": state})

@app.route('/oauth/callback')
def callback():
    code = request.args.get('code')
    state = request.args.get('state')
    logger.info(f"收到OAuth回调，code: {code}, state: {state}")
    
    db_state = OAuthState.query.filter_by(state=state).first()
    if not db_state:
        logger.warning(f"收到无效的state: {state}")
        return jsonify({"error": "Invalid state"}), 400
    db.session.delete(db_state)
    db.session.commit()
    logger.info(f"验证并删除state: {state}")

    logger.info(f"开始请求访问令牌")
    token_response = requests.post(TOKEN_ENDPOINT, data={
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': REDIRECT_URI,
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET
    })

    if token_response.status_code != 200:
        logger.error(f"获取访问令牌失败。状态码: {token_response.status_code}，响应: {token_response.text}")
        return jsonify({"error": "Failed to obtain access token"}), 400

    token_data = token_response.json()
    logger.info(f"成功获取访问令牌，有效期: {token_data.get('expires_in')} 秒")

    access_token = token_data['access_token']
    refresh_token = token_data.get('refresh_token')
    expires_in = token_data.get('expires_in', 3600)

    logger.info(f"开始获取用户信息")
    user_response = requests.get(USER_ENDPOINT, headers={'Authorization': f"Bearer {access_token}"})
    
    if user_response.status_code != 200:
        logger.error(f"获取用户信息失败。状态码: {user_response.status_code}，响应: {user_response.text}")
        return jsonify({"error": "Failed to obtain user info"}), 400

    user_info = user_response.json()
    user_id = str(user_info.get('id'))
    logger.info(f"成功获取用户信息，用户ID: {user_id}")

    user_session = UserSession.query.filter_by(user_id=user_id).first()
    if user_session:
        logger.info(f"更新现有用户会话，用户ID: {user_id}")
        user_session.access_token = access_token
        user_session.refresh_token = refresh_token
        user_session.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        user_session.user_info = json.dumps(user_info)
    else:
        logger.info(f"创建新用户会话，用户ID: {user_id}")
        user_session = UserSession(
            user_id=user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expiry=datetime.now(timezone.utc) + timedelta(seconds=expires_in),
            user_info=json.dumps(user_info)
        )
        db.session.add(user_session)
    
    db.session.commit()
    logger.info(f"用户会话已创建/更新，用户ID: {user_id}")

    temp_token = secrets.token_urlsafe(32)
    new_temp_token = TempToken(token=temp_token, user_id=user_id)
    db.session.add(new_temp_token)
    db.session.commit()
    logger.info(f"创建临时令牌: {temp_token}，用户ID: {user_id}")

    redirect_url = f"{PROGRAM_SERVICE_URL}/auth/complete?token={temp_token}"
    logger.info(f"重定向到程序服务: {redirect_url}")
    return redirect(redirect_url)

@app.route('/oauth/userinfo', methods=['POST'])
def get_user_info():
    temp_token = request.json.get('temp_token')
    access_token = request.json.get('access_token')

    if not temp_token and not access_token:
        logger.warning("未提供令牌")
        return jsonify({"error": "No token provided"}), 400

    user_id = None
    if temp_token:
        # 处理临时令牌
        token_record = TempToken.query.filter_by(token=temp_token).first()
        if token_record:
            user_id = token_record.user_id
            logger.info(f"临时令牌有效，用户ID: {user_id}")
            db.session.delete(token_record)
            db.session.commit()
            logger.info(f"临时令牌已删除，用户ID: {user_id}")
        else:
            logger.warning(f"无效的临时令牌: {temp_token}")
            return jsonify({"error": "Invalid temporary token"}), 400
    elif access_token:
        # 处理访问令牌
        user_session = UserSession.query.filter_by(access_token=access_token).first()
        if user_session:
            if user_session.token_expiry < datetime.now(timezone.utc):
                logger.warning(f"访问令牌已过期，用户ID: {user_session.user_id}")
                return jsonify({"error": "Access token expired"}), 401
            user_id = user_session.user_id
        else:
            logger.warning(f"无效的访问令牌")
            return jsonify({"error": "Invalid access token"}), 401

    user_session = UserSession.query.filter_by(user_id=user_id).first()
    if not user_session:
        logger.error(f"未找到用户会话，用户ID: {user_id}")
        return jsonify({"error": "User session not found"}), 404

    logger.info(f"返回用户信息，用户ID: {user_id}")
    return jsonify({
        "user_info": json.loads(user_session.user_info),
        "access_token": user_session.access_token,
        "refresh_token": user_session.refresh_token,
        "token_expiry": user_session.token_expiry.isoformat()
    })

@app.route('/oauth/refresh', methods=['POST'])
def refresh_token():
    refresh_token = request.json.get('refresh_token')
    if not refresh_token:
        logger.warning("未提供刷新令牌")
        return jsonify({"error": "No refresh token provided"}), 400

    logger.info(f"开始刷新令牌")
    token_response = requests.post(TOKEN_ENDPOINT, data={
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET
    })

    if token_response.status_code != 200:
        logger.error(f"刷新令牌失败。状态码: {token_response.status_code}，响应: {token_response.text}")
        return jsonify({"error": "Failed to refresh token"}), 400

    new_token_data = token_response.json()
    logger.info(f"成功刷新令牌，新的有效期: {new_token_data.get('expires_in')} 秒")

    user_session = UserSession.query.filter_by(refresh_token=refresh_token).first()
    if user_session:
        user_session.access_token = new_token_data['access_token']
        user_session.refresh_token = new_token_data.get('refresh_token', refresh_token)
        user_session.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=new_token_data.get('expires_in', 3600))
        db.session.commit()
        logger.info(f"用户会话已更新，用户ID: {user_session.user_id}")
    else:
        logger.warning(f"未找到与刷新令牌关联的用户会话")
        return jsonify({"error": "User session not found"}), 404

    return jsonify(new_token_data)

@app.route('/oauth/logout', methods=['POST'])
def logout():
    user_id = request.json.get('user_id')
    if not user_id:
        logger.warning("未提供用户ID")
        return jsonify({"error": "No user ID provided"}), 400

    user_session = UserSession.query.filter_by(user_id=user_id).first()
    if user_session:
        db.session.delete(user_session)
        db.session.commit()
        logger.info(f"用户已登出，用户ID: {user_id}")
    else:
        logger.warning(f"未找到用户会话，无法登出，用户ID: {user_id}")

    return jsonify({"message": "Logged out successfully"})

@app.route('/health')
def health_check():
    logger.info("健康检查请求")
    return jsonify({"status": "healthy"}), 200

@app.route('/oauth/verify', methods=['POST'])
def verify_token():
    access_token = request.json.get('access_token')
    if not access_token:
        logger.warning("未提供访问令牌")
        return jsonify({"error": "No access token provided"}), 400

    user_session = UserSession.query.filter_by(access_token=access_token).first()
    if not user_session:
        logger.warning(f"未找到与访问令牌关联的用户会话")
        return jsonify({"error": "Invalid access token"}), 401

    # 确保 token_expiry 是带时区信息的
    token_expiry = user_session.token_expiry.replace(tzinfo=timezone.utc)
    if token_expiry < datetime.now(timezone.utc):
        logger.warning(f"访问令牌已过期，用户ID: {user_session.user_id}")
        return jsonify({"error": "Access token expired"}), 401

    logger.info(f"访问令牌验证成功，用户ID: {user_session.user_id}")
    return jsonify({
        "user_id": user_session.user_id,
        "user_info": json.loads(user_session.user_info),
        "token_expiry": token_expiry.isoformat()
    })

if __name__ == '__main__':
    logger.info(f"启动认证服务，监听端口: 25002")
    app.run(host='0.0.0.0', port=25002)
