import sqlite3
import os
import hashlib
import time
import schedule
import logging
from dotenv import load_dotenv
from datetime import datetime
from logging.handlers import RotatingFileHandler
import sys
# import fc
import subprocess
import shutil


# 加载 .env 文件中的环境变量
load_dotenv()

# 配置日志
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# 确保日志文件夹存在
os.makedirs('./logs', exist_ok=True)

# 创建一个rotating file handler
file_handler = RotatingFileHandler('./logs/database_backup.log', maxBytes=1024*1024, backupCount=5)
file_handler.setLevel(logging.INFO)

# 创建一个stream handler用于控制台输出
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)

# 创建一个格式化器
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
file_handler.setFormatter(formatter)
console_handler.setFormatter(formatter)

# 将处理器添加到logger
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# 从环境变量获取数据库和备份路径
ORIGINAL_DB = os.getenv('ORIGINAL_DB_PATH')
BACKUP_DB = os.getenv('BACKUP_DB_PATH')
TEMP_RESTORE_DB = os.getenv('TEMP_RESTORE_DB_PATH')

# 从环境变量获取重试配置
MAX_RETRIES = int(os.getenv('MAX_RETRIES', 3))
RETRY_INTERVAL = int(os.getenv('RETRY_INTERVAL', 60))  # 秒

# 从环境变量获取备份时间点和备份文件前缀
BACKUP_TIMES = os.getenv('BACKUP_TIMES', '10:00,14:00,18:00').split(',')
BACKUP_PREFIX = os.getenv('BACKUP_PREFIX', 'images_backup_')

# 最大保留的备份数量
MAX_BACKUPS = int(os.getenv('MAX_BACKUPS', 5))

# 确保备份目录存在
BACKUP_DIR = os.path.dirname(BACKUP_DB)
os.makedirs(BACKUP_DIR, exist_ok=True)

# 确保所有必要的目录都存在
os.makedirs(os.path.dirname(ORIGINAL_DB), exist_ok=True)
os.makedirs(os.path.dirname(BACKUP_DB), exist_ok=True)
os.makedirs(os.path.dirname(TEMP_RESTORE_DB), exist_ok=True)

def progress(status, remaining, total):
    logger.info(f'备份进度: 已复制 {total-remaining} 页，共 {total} 页')

def disable_wal_mode(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA journal_mode=DELETE;')
    conn.close()

def enable_wal_mode(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA journal_mode=WAL;')
    conn.close()

def lock_database(db_path):
    lock_file = f"{db_path}.lock"
    try:
        with open(lock_file, 'x') as f:
            f.write(str(os.getpid()))
        return lock_file
    except FileExistsError:
        return None

def unlock_database(lock_file):
    if lock_file and os.path.exists(lock_file):
        os.remove(lock_file)

def get_backup_filename():
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return os.path.join(BACKUP_DIR, f"{BACKUP_PREFIX}{timestamp}.db")

def backup_database():
    backup_file = get_backup_filename()
    logger.info(f"开始数据库备份: 原始数据库 {ORIGINAL_DB} -> 备份数据库 {backup_file}")
    
    lock_file = lock_database(ORIGINAL_DB)
    if lock_file is None:
        logger.error("无法获取数据库锁，可能有其他进程正在访问数据库")
        return False

    try:
        # 执行备份操作
        source = sqlite3.connect(ORIGINAL_DB)
        dest = sqlite3.connect(backup_file)
        
        logger.info("设置数据库模式")
        source.execute('PRAGMA journal_mode=WAL;')
        dest.execute('PRAGMA journal_mode=WAL;')

        source.backup(dest)
        logger.info(f"备份进度: 已复制 {dest.total_changes} 页，共 {source.total_changes} 页")
        
        dest.close()
        source.close()
    except Exception as e:
        logger.error(f"备份过程中发生错误: {str(e)}")
        return False
    finally:
        unlock_database(lock_file)

    logger.info("数据库备份成功完成")
    return backup_file

def verify_integrity():
    logger.info("开始进行数据库完整性检查")
    conn = sqlite3.connect(BACKUP_DB)
    cursor = conn.cursor()
    cursor.execute("PRAGMA integrity_check")
    result = cursor.fetchone()
    conn.close()
    if result[0] == "ok":
        logger.info("数据库完整性检查通过")
        return True
    else:
        logger.error(f"数据库完整性检查失败: {result[0]}")
        return False

def compare_record_counts(original_db, backup_db):
    logger.info("开始比较记录数")
    try:
        original_conn = sqlite3.connect(original_db)
        backup_conn = sqlite3.connect(backup_db)
        
        original_cursor = original_conn.cursor()
        backup_cursor = backup_conn.cursor()
        
        # 检查原始数据库中的表
        original_cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        original_tables = set(table[0] for table in original_cursor.fetchall())
        logger.info(f"原始数据库中的表: {', '.join(original_tables)}")
        
        # 检查备份数据库中的表
        backup_cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        backup_tables = set(table[0] for table in backup_cursor.fetchall())
        logger.info(f"备份数据库中的表: {', '.join(backup_tables)}")
        
        if original_tables != backup_tables:
            logger.error("原始数据库和备份数据库的表不匹配")
            return False
        
        for table in original_tables:
            original_cursor.execute(f"SELECT COUNT(*) FROM {table}")
            backup_cursor.execute(f"SELECT COUNT(*) FROM {table}")
            
            original_count = original_cursor.fetchone()[0]
            backup_count = backup_cursor.fetchone()[0]
            
            logger.info(f"{table} 表记录数 - 原始数据库: {original_count}, 备份数据库: {backup_count}")
            
            if original_count != backup_count:
                logger.error(f"{table} 表记录数不匹配")
                return False
        
        logger.info("所有表的记录数匹配")
        return True
    except sqlite3.Error as e:
        logger.error(f"比较记录数时发生错误: {str(e)}")
        return False
    finally:
        original_conn.close()
        backup_conn.close()

def calculate_checksum(db_path):
    logger.info(f"开始计算数据库校验和: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    checksum = hashlib.sha256()

    try:
        # 获取所有表名
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()

        for table in tables:
            table_name = table[0]
            # 获取表的所有数据
            cursor.execute(f"SELECT * FROM {table_name}")
            rows = cursor.fetchall()
            
            # 将每行数据转换为字符串并更新校验和
            for row in rows:
                row_string = '|'.join(str(item) for item in row)
                checksum.update(row_string.encode('utf-8'))

    except sqlite3.Error as e:
        logger.error(f"计算校验和时发生错误: {str(e)}")
    finally:
        conn.close()

    return checksum.hexdigest()

def compare_checksums(original_db, backup_db):
    logger.info("开始比较数据库校验和")
    original_checksum = calculate_checksum(original_db)
    backup_checksum = calculate_checksum(backup_db)

    logger.info(f"原始数据库校验和: {original_checksum}")
    logger.info(f"备份数据库校验和: {backup_checksum}")

    if original_checksum == backup_checksum:
        logger.info("数据库校验和匹配")
        return True
    else:
        logger.error(f"数据库校验和不匹配: 原始 {original_checksum}, 备份 {backup_checksum}")
        return False

def test_restore(backup_db):
    logger.info("开始进行恢复测试")
    conn = None
    try:
        # 确保临时恢复目录存在
        os.makedirs(os.path.dirname(TEMP_RESTORE_DB), exist_ok=True)
        
        # 复制备份数据库到临时位置
        shutil.copy2(backup_db, TEMP_RESTORE_DB)
        
        # 尝试连接到恢复的数据库
        conn = sqlite3.connect(TEMP_RESTORE_DB)
        cursor = conn.cursor()
        
        # 执行一些查询来验证数据
        cursor.execute("SELECT COUNT(*) FROM image")
        count = cursor.fetchone()[0]
        logger.info(f"恢复的数据库中 image 表的记录数: {count}")
        
        # 可以添加更多的验证查询
        
        logger.info("恢复测试成功完成")
        return True
    except Exception as e:
        logger.error(f"恢复测试过程中发生错误: {str(e)}")
        return False
    finally:
        if conn:
            conn.close()
        
        # 给系统一些时间来释放文件句柄
        time.sleep(1)
        
        # 尝试删除临时文件，但如果失败，只记录警告
        try:
            os.remove(TEMP_RESTORE_DB)
        except Exception as e:
            logger.warning(f"无法删除临时恢复数据库文件: {str(e)}")

def verify_backup(backup_file):
    logger.info(f"开始验证备份: {backup_file}")
    
    checks = [
        ("完整性检查", lambda: check_database_integrity(backup_file)),
        ("记录数比较", lambda: compare_record_counts(ORIGINAL_DB, backup_file)),
        ("校验和比较", lambda: compare_checksums(ORIGINAL_DB, backup_file)),
        ("恢复测试", lambda: test_restore(backup_file))
    ]
    
    for check_name, check_func in checks:
        logger.info(f"开始 {check_name}")
        try:
            if not check_func():
                logger.error(f"{check_name} 失败")
                return False
            logger.info(f"{check_name} 通过")
        except Exception as e:
            logger.error(f"{check_name} 过程中发生错误: {str(e)}")
            return False
    
    logger.info("备份验证成功完成")
    return True

def backup_and_verify():
    logger.info(f"开始备份和验证过程，最大重试次数: {MAX_RETRIES}")
    for attempt in range(MAX_RETRIES):
        backup_file = backup_database()
        if backup_file and verify_backup(backup_file):
            logger.info("备份和验证成功完成")
            cleanup_old_backups()
            return
        else:
            logger.warning(f"备份或验证失败，将在 {RETRY_INTERVAL} 秒后进行第 {attempt + 1} 次重试")
            time.sleep(RETRY_INTERVAL)
    
    logger.error("备份和验证过程失败，达到最大重试次数")

def cleanup_old_backups():
    """清理旧的备份文件，只保留最新的 MAX_BACKUPS 个备份"""
    backups = sorted([f for f in os.listdir(BACKUP_DIR) if f.startswith(BACKUP_PREFIX)], reverse=True)
    for old_backup in backups[MAX_BACKUPS:]:
        os.remove(os.path.join(BACKUP_DIR, old_backup))
        logger.info(f"删除旧的备份文件: {old_backup}")

def check_database_status(db_path):
    logger.info(f"检查数据库状态: {db_path}")
    try:
        if not os.path.exists(db_path):
            logger.error(f"数据库文件不存在: {db_path}")
            return

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()
        if tables:
            logger.info(f"数据库中的表: {', '.join([table[0] for table in tables])}")
            for table in tables:
                cursor.execute(f"PRAGMA table_info({table[0]});")
                columns = cursor.fetchall()
                logger.info(f"表 {table[0]} 的结构: {columns}")
                cursor.execute(f"SELECT COUNT(*) FROM {table[0]};")
                count = cursor.fetchone()[0]
                logger.info(f"表 {table[0]} 中的记录数: {count}")
        else:
            logger.warning("数据库中没有表")
        
        conn.close()
    except Exception as e:
        logger.error(f"检查数据库状态时发生错误: {str(e)}", exc_info=True)

def check_database_integrity(db_path):
    logger.info(f"开始进行数据库完整性检查: {db_path}")
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA integrity_check")
        result = cursor.fetchone()
        if result[0] == "ok":
            logger.info("数据库完整性检查通过")
            return True
        else:
            logger.error(f"数据库完整性检查失败: {result[0]}")
            return False
    except sqlite3.Error as e:
        logger.error(f"执行完整性检查时发生错误: {str(e)}")
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    check_database_status(ORIGINAL_DB)
    logger.info(f"数据库备份脚本启动，计划备份时间: {', '.join(BACKUP_TIMES)}")
    
    # 设置定时任务
    for backup_time in BACKUP_TIMES:
        schedule.every().day.at(backup_time.strip()).do(backup_and_verify)
    
    while True:
        schedule.run_pending()
        time.sleep(1)
