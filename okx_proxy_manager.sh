#!/bin/bash
# OKX代理服务管理脚本
# 用于自动化端口清理、服务重启和监控

SERVICE_NAME="okx-proxy"
SERVICE_PORT=8080
SERVICE_FILE="/root/hk_server_proxy.js"
LOG_FILE="/root/proxy_manager.log"

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 检查端口占用
check_port() {
    local pid=$(lsof -ti:$SERVICE_PORT)
    if [ ! -z "$pid" ]; then
        echo "$pid"
    else
        echo ""
    fi
}

# 强制清理端口
cleanup_port() {
    log "开始清理端口 $SERVICE_PORT..."
    local pid=$(check_port)
    if [ ! -z "$pid" ]; then
        log "发现进程 $pid 占用端口 $SERVICE_PORT，正在终止..."
        kill -9 $pid
        sleep 2
        
        # 再次检查
        pid=$(check_port)
        if [ ! -z "$pid" ]; then
            log "警告: 端口 $SERVICE_PORT 仍被进程 $pid 占用"
            return 1
        else
            log "端口 $SERVICE_PORT 清理成功"
        fi
    else
        log "端口 $SERVICE_PORT 未被占用"
    fi
    return 0
}

# 启动服务
start_service() {
    log "启动 $SERVICE_NAME 服务..."
    
    # 检查文件是否存在
    if [ ! -f "$SERVICE_FILE" ]; then
        log "错误: 服务文件 $SERVICE_FILE 不存在"
        return 1
    fi
    
    # 启动服务
    pm2 start "$SERVICE_FILE" --name "$SERVICE_NAME" 2>&1 | tee -a "$LOG_FILE"
    
    # 等待服务启动
    sleep 3
    
    # 检查服务状态
    if pm2 list | grep -q "$SERVICE_NAME.*online"; then
        log "$SERVICE_NAME 服务启动成功"
        return 0
    else
        log "错误: $SERVICE_NAME 服务启动失败"
        return 1
    fi
}

# 停止服务
stop_service() {
    log "停止 $SERVICE_NAME 服务..."
    pm2 delete "$SERVICE_NAME" 2>&1 | tee -a "$LOG_FILE"
    sleep 2
}

# 重启服务
restart_service() {
    log "重启 $SERVICE_NAME 服务..."
    
    # 停止现有服务
    stop_service
    
    # 清理端口
    if ! cleanup_port; then
        log "错误: 端口清理失败"
        return 1
    fi
    
    # 启动服务
    if start_service; then
        log "$SERVICE_NAME 服务重启成功"
        return 0
    else
        log "错误: $SERVICE_NAME 服务重启失败"
        return 1
    fi
}

# 检查服务健康状态
check_health() {
    local response=$(curl -s -w "%{http_code}" http://localhost:$SERVICE_PORT/health -o /dev/null)
    if [ "$response" = "200" ]; then
        return 0
    else
        return 1
    fi
}

# 监控服务
monitor_service() {
    log "开始监控 $SERVICE_NAME 服务..."
    
    while true; do
        if check_health; then
            log "$SERVICE_NAME 服务健康检查通过"
        else
            log "警告: $SERVICE_NAME 服务健康检查失败，尝试重启..."
            if restart_service; then
                log "$SERVICE_NAME 服务重启成功"
            else
                log "错误: $SERVICE_NAME 服务重启失败，等待下次检查"
            fi
        fi
        
        # 等待5分钟后再次检查
        sleep 300
    done
}

# 主函数
case "$1" in
    start)
        start_service
        ;;
    stop)
        stop_service
        ;;
    restart)
        restart_service
        ;;
    cleanup)
        cleanup_port
        ;;
    monitor)
        monitor_service
        ;;
    status)
        if check_health; then
            echo "$SERVICE_NAME 服务运行正常"
            exit 0
        else
            echo "$SERVICE_NAME 服务异常"
            exit 1
        fi
        ;;
    *)
        echo "用法: $0 {start|stop|restart|cleanup|monitor|status}"
        echo "  start   - 启动服务"
        echo "  stop    - 停止服务"
        echo "  restart - 重启服务"
        echo "  cleanup - 清理端口"
        echo "  monitor - 监控服务(持续运行)"
        echo "  status  - 检查服务状态"
        exit 1
        ;;
esac

exit $?