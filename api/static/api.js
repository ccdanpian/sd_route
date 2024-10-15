// api.js

// 用于存储 token 的键名
const TOKEN_KEY = 'authToken';

// 获取存储的 token
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

// 存储 token
export function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

// 清除 token
export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

// 通用的 API 请求函数
export async function apiRequest(url, method = 'GET', data = null) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        method,
        headers,
    };

    if (data) {
        config.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(url, config);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return await response.json();
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// 登录函数
export async function login() {
    // 这里应该是调用你的登录接口的逻辑
    // 假设登录成功后，服务器返回包含 token 的响应
    const response = await apiRequest('/auth/login', 'POST', { /* 登录数据 */ });
    if (response.token) {
        setToken(response.token);
    }
    return response;
}

// 登出函数
export function logout() {
    clearToken();
    // 可能还需要调用后端的登出接口
}