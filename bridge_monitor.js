/**
 * WorkBuddy ↔ mainfold-agent 文件接口层监控脚本
 * 
 * 功能：
 * 1. 监控 INBOX.md 变更
 * 2. 监控 STATUS.md 变更
 * 3. 监控 TASKS/ 目录变更
 * 4. 记录操作日志
 * 
 * 使用方法：
 * node bridge_monitor.js
 * 
 * 依赖：
 * - fs (Node.js 内置)
 * - path (Node.js 内置)
 */

const fs = require('fs');
const path = require('path');

// 配置
const BRIDGE_DIR = 'G:\\shared-workspace\\workbuddy-mainfold-bridge';
const LOG_FILE = path.join(BRIDGE_DIR, 'LOGS', 'mainfold.log');
const POLL_INTERVAL = 5000; // 5秒

// 状态追踪
const fileStates = new Map();
let isRunning = true;

/**
 * 日志记录
 */
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;
  
  console.log(logEntry.trim());
  
  try {
    fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
  } catch (error) {
    console.error(`Failed to write log: ${error.message}`);
  }
}

/**
 * 获取文件状态
 */
function getFileState(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime.getTime(),
      exists: true
    };
  } catch (error) {
    return {
      size: 0,
      mtime: 0,
      exists: false
    };
  }
}

/**
 * 检查文件变更
 */
function checkFileChanges(filePath, fileName) {
  const currentState = getFileState(filePath);
  const previousState = fileStates.get(filePath);
  
  if (!previousState) {
    // 首次检查
    fileStates.set(filePath, currentState);
    log(`Initial check: ${fileName} (${currentState.exists ? 'exists' : 'not found'})`);
    return;
  }
  
  // 检查变更
  if (currentState.exists !== previousState.exists) {
    if (currentState.exists) {
      log(`File created: ${fileName}`, 'INFO');
    } else {
      log(`File deleted: ${fileName}`, 'WARN');
    }
    fileStates.set(filePath, currentState);
    return;
  }
  
  if (currentState.exists && currentState.mtime !== previousState.mtime) {
    log(`File modified: ${fileName} (size: ${currentState.size})`, 'INFO');
    fileStates.set(filePath, currentState);
    return;
  }
}

/**
 * 检查目录变更
 */
function checkDirectoryChanges(dirPath, dirName) {
  try {
    const items = fs.readdirSync(dirPath);
    const currentState = items.join(',');
    const previousState = fileStates.get(dirPath);
    
    if (!previousState) {
      fileStates.set(dirPath, currentState);
      log(`Initial check: ${dirName}/ (${items.length} items)`);
      return;
    }
    
    if (currentState !== previousState) {
      log(`Directory changed: ${dirName}/ (${items.length} items)`, 'INFO');
      fileStates.set(dirPath, currentState);
    }
  } catch (error) {
    log(`Failed to read directory ${dirName}: ${error.message}`, 'ERROR');
  }
}

/**
 * 主监控循环
 */
function monitor() {
  if (!isRunning) return;
  
  try {
    // 检查核心文件
    checkFileChanges(path.join(BRIDGE_DIR, 'INBOX.md'), 'INBOX.md');
    checkFileChanges(path.join(BRIDGE_DIR, 'STATUS.md'), 'STATUS.md');
    
    // 检查 CONTEXT_PACK 目录
    checkDirectoryChanges(path.join(BRIDGE_DIR, 'CONTEXT_PACK'), 'CONTEXT_PACK');
    
    // 检查 TASKS 目录
    checkDirectoryChanges(path.join(BRIDGE_DIR, 'TASKS'), 'TASKS');
    
    // 检查 LOGS 目录
    checkDirectoryChanges(path.join(BRIDGE_DIR, 'LOGS'), 'LOGS');
    
  } catch (error) {
    log(`Monitor error: ${error.message}`, 'ERROR');
  }
  
  // 安排下次检查
  setTimeout(monitor, POLL_INTERVAL);
}

/**
 * 优雅关闭
 */
function shutdown() {
  log('Shutting down monitor...');
  isRunning = false;
  process.exit(0);
}

// 注册信号处理
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 启动监控
log('Starting WorkBuddy ↔ mainfold-agent bridge monitor...');
log(`Bridge directory: ${BRIDGE_DIR}`);
log(`Poll interval: ${POLL_INTERVAL}ms`);

// 初始检查
monitor();

log('Monitor started successfully');