import os
import shutil
from datetime import datetime, timedelta
import threading
import time
import logging

logger = logging.getLogger(__name__)

def delete_old_images(output_dir, interval_minutes, retention_hours):
    while True:
        try:
            current_time = datetime.now()
            cutoff_time = current_time - timedelta(hours=retention_hours)
            
            for folder_name in os.listdir(output_dir):
                folder_path = os.path.join(output_dir, folder_name)
                if os.path.isdir(folder_path):
                    folder_time = datetime.fromtimestamp(os.path.getctime(folder_path))
                    if folder_time < cutoff_time:
                        shutil.rmtree(folder_path)
                        logger.info(f"Deleted old folder: {folder_path}")
                else:
                    file_time = datetime.fromtimestamp(os.path.getctime(folder_path))
                    if file_time < cutoff_time:
                        os.remove(folder_path)
                        logger.info(f"Deleted old file: {folder_path}")
            
            logger.info("Completed deletion of old images")
        except Exception as e:
            logger.error(f"Error during deletion of old images: {str(e)}")
        
        # 等待指定的分钟数
        time.sleep(interval_minutes * 60)

def start_image_cleaner(output_dir, interval_minutes, retention_hours):
    delete_thread = threading.Thread(
        target=delete_old_images, 
        args=(output_dir, interval_minutes, retention_hours),
        daemon=True
    )
    delete_thread.start()
    logger.info(f"Started image cleaner thread. Cleaning every {interval_minutes} minute(s), retaining images for {retention_hours} hours.")
