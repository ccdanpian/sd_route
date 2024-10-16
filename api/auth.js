from flask import request, jsonify, make_response, session, redirect, url_for
from functools import wraps
import requests
import os
import logging
from dotenv import load_dotenv
import jwt
from datetime import datetime, timedelta
from token_cache import token_cache
from app import app  # 从 app.py 导入 app

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 从环境变量获取配置
load_dotenv()
AUTH_SERVICE_URL = os.getenv('AUTH_SERVICE_URL', 'http://localhost:25002')
JWT_SECRET = os.getenv('JWT_SECRET')
JWT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        access_token = request.cookies.get('access_token') or session.get('access_token')
        
        if not access_token:
            logger.warning("需要认证：未找到访问令牌")
            return jsonify({"error": "Authentication required"}), 401
        
        logger.info("验证访问令牌")
        
        cached_info = token_cache.get(access_token)
        if cached_info:
            user_id, user_info, expiry = cached_info
            session['user_id'] = user_id
            session['user_info'] = user_info
            session['token_expiry'] = expiry.isoformat()
            session['access_token'] = access_token
            logger.info("使用缓存的令牌信息")
            return f(*args, **kwargs)
        
        try:
            # 使用 /oauth/verify 端点验证令牌
            verify_response = requests.post(f"{AUTH_SERVICE_URL}/oauth/verify", 
                                            json={"access_token": access_token})
            
            if verify_response.status_code != 200:
                raise jwt.InvalidTokenError("Invalid token")
            
            user_info = verify_response.json()
            session['user_id'] = user_info['user_info']['id']
            session['user_info'] = user_info['user_info']
            session['token_expiry'] = user_info['token_expiry']
            session['access_token'] = access_token
            
            # 缓存令牌信息
            expiry = datetime.fromisoformat(user_info['token_expiry'])
            token_cache.set(access_token, session['user_id'], session['user_info'], expiry)
            
        except jwt.ExpiredSignatureError:
            logger.warning("令牌已过期")
            if refresh_access_token():
                return decorated(*args, **kwargs)
            else:
                session.clear()
                token_cache.delete(access_token)
                response = make_response(jsonify({"error": "Token expired", "auth_url": url_for('login', _external=True)}), 401)
                response.delete_cookie('access_token')
                return response
        except jwt.InvalidTokenError:
            logger.warning("无效的令牌")
            session.clear()
            token_cache.delete(access_token)
            response = make_response(jsonify({"error": "Invalid token", "auth_url": url_for('login', _external=True)}), 401)
            response.delete_cookie('access_token')
            return response
        
        return f(*args, **kwargs)
    return decorated

def login():
    logger.info("用户请求登录")
    auth_response = requests.get(f"{AUTH_SERVICE_URL}/oauth/authorize")
    if auth_response.status_code == 200:
        auth_data = auth_response.json()
        logger.info(f"重定向到认证服务的授权 URL: {auth_data['auth_url']}")
        return redirect(auth_data['auth_url'])
    else:
        logger.error("启动认证过程失败")
        return jsonify({"error": "Failed to start authentication process"}), 500

@app.route('/auth/complete')
def auth_complete():
    logger.info("收到认证完成回调")
    temp_token = request.args.get('token')
    if not temp_token:
        logger.warning("未提供临时令牌")
        return jsonify({"error": "No token provided"}), 400

    logger.info("使用临时令牌获取用户信息")
    user_info_response = requests.post(f"{AUTH_SERVICE_URL}/oauth/userinfo", 
                                       json={"temp_token": temp_token})
    if user_info_response.status_code != 200:
        logger.error(f"获取用户信息失败: {user_info_response.text}")
        return jsonify({"error": "Failed to get user info"}), 400

    user_data = user_info_response.json()
    
    logger.info(f"用户 {user_data['user_info']['id']} 认证成功")
    session['access_token'] = user_data['access_token']
    session['refresh_token'] = user_data['refresh_token']
    session['token_expiry'] = user_data['token_expiry']
    session['user_info'] = user_data['user_info']
    session['user_id'] = user_data['user_info']['id']

    # 确保 expiry 是一个没有时区信息的 datetime 对象
    expiry = datetime.fromisoformat(user_data['token_expiry']).replace(tzinfo=None)
    
    response = make_response(redirect(url_for('index')))
    response.set_cookie('access_token', user_data['access_token'], 
                        max_age=3600*24*7, httponly=False, secure=True, samesite='Strict')
    response.set_cookie('auth_success', 'true', 
                        max_age=300, httponly=False, secure=True, samesite='Strict')
    
    logger.info(f"认证完成，重定向到首页")
    token_cache.set(session['access_token'], session['user_id'], session['user_info'], expiry)
    return response

def refresh_access_token(session):
    if 'refresh_token' not in session:
        logger.warning("没有可用的刷新令牌")
        return False

    logger.info("尝试刷新访问令牌")
    refresh_response = requests.post(f"{AUTH_SERVICE_URL}/oauth/refresh", 
                                     json={"refresh_token": session['refresh_token']})
    if refresh_response.status_code == 200:
        new_token_data = refresh_response.json()
        session['access_token'] = new_token_data['access_token']
        session['refresh_token'] = new_token_data.get('refresh_token', session['refresh_token'])
        session['token_expiry'] = new_token_data['expires_in']
        
        # 更新缓存
        expiry = datetime.fromisoformat(new_token_data['expires_in'])
        token_cache.set(session['access_token'], session['user_id'], session['user_info'], expiry)
        
        logger.info("访问令牌刷新成功")
        return True
    logger.warning("刷新访问令牌失败")
    return False

# 添加定期清理过期缓存的函数
def clean_expired_cache():
    token_cache.clean_expired()
    logger.info("已清理过期的令牌缓存")

# 可以设置一个定时任务来定期调用 clean_expired_cache 函数

def logout(session):
    user_id = session.get('user_id')
    logger.info(f"用户 {user_id} 请求登出")
    if user_id:
        logout_response = requests.post(f"{AUTH_SERVICE_URL}/oauth/logout", json={"user_id": user_id})
        if logout_response.status_code == 200:
            logger.info(f"用户 {user_id} 在认证服务中成功登出")
        else:
            logger.warning(f"用户 {user_id} 在认证服务中登出失败")
    session.clear()
    logger.info(f"用户 {user_id} 已成功从本地会话登出")
    return redirect(url_for('index'))
