/**
 * 时间戳标准化工具
 * 统一处理各种时间字段格式和命名
 */

/**
 * 标准化时间戳字段名称映射
 */
export const TIMESTAMP_FIELD_MAPPING = {
  // 创建时间字段
  created_at: ['created_at', 'createdAt', 'create_time', 'createTime', 'timestamp'],
  // 更新时间字段
  updated_at: ['updated_at', 'updatedAt', 'update_time', 'updateTime', 'modified_at', 'modifiedAt'],
  // 退出时间字段
  exit_time: ['exit_time', 'exitTime', 'close_time', 'closeTime', 'end_time', 'endTime']
};

/**
 * 从对象中提取并标准化时间戳
 */
export function extractTimestamp(obj: any, fieldType: keyof typeof TIMESTAMP_FIELD_MAPPING): Date {
  const possibleFields = TIMESTAMP_FIELD_MAPPING[fieldType];
  
  for (const field of possibleFields) {
    const value = obj[field];
    if (value !== null && value !== undefined) {
      const normalized = normalizeTimestamp(value);
      if (normalized) {
        return normalized;
      }
    }
  }
  
  // 如果没有找到有效的时间戳，返回当前时间
  return new Date();
}

/**
 * 标准化单个时间戳值
 */
export function normalizeTimestamp(value: any): Date | null {
  if (!value) {
    return null;
  }
  
  // 如果已经是 Date 对象
  if (value instanceof Date) {
    return isValidDate(value) ? value : null;
  }
  
  // 如果是字符串
  if (typeof value === 'string') {
    // 处理 ISO 字符串
    if (value.includes('T') || value.includes('-')) {
      const date = new Date(value);
      return isValidDate(date) ? date : null;
    }
    
    // 处理纯数字字符串
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      return normalizeNumericTimestamp(numValue);
    }
  }
  
  // 如果是数字
  if (typeof value === 'number') {
    return normalizeNumericTimestamp(value);
  }
  
  return null;
}

/**
 * 标准化数字时间戳
 */
function normalizeNumericTimestamp(value: number): Date | null {
  if (!isFinite(value) || value <= 0) {
    return null;
  }
  
  // 判断是秒还是毫秒
  // 如果小于 10^10，认为是秒级时间戳
  const timestamp = value < 10000000000 ? value * 1000 : value;
  
  const date = new Date(timestamp);
  return isValidDate(date) ? date : null;
}

/**
 * 检查 Date 对象是否有效
 */
function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * 标准化对象的所有时间戳字段
 */
export function normalizeObjectTimestamps(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  const normalized = { ...obj };
  
  // 标准化创建时间
  const createdAt = extractTimestamp(obj, 'created_at');
  normalized.created_at = createdAt;
  
  // 标准化更新时间
  const updatedAt = extractTimestamp(obj, 'updated_at');
  normalized.updated_at = updatedAt;
  
  // 标准化退出时间（如果存在）
  if (hasAnyField(obj, TIMESTAMP_FIELD_MAPPING.exit_time)) {
    const exitTime = extractTimestamp(obj, 'exit_time');
    normalized.exit_time = exitTime;
  }
  
  return normalized;
}

/**
 * 检查对象是否包含指定字段列表中的任何一个
 */
function hasAnyField(obj: any, fields: string[]): boolean {
  return fields.some(field => obj[field] !== null && obj[field] !== undefined);
}

/**
 * 生成时间桶（用于去重）
 */
export function generateTimeBucket(timestamp: Date, bucketSizeMs: number = 5000): number {
  const time = timestamp.getTime();
  return Math.floor(time / bucketSizeMs) * bucketSizeMs;
}

/**
 * 格式化时间戳为显示字符串
 */
export function formatTimestampForDisplay(timestamp: Date, format: 'datetime' | 'date' | 'time' = 'datetime'): string {
  if (!isValidDate(timestamp)) {
    return '--';
  }
  
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Shanghai'
  };
  
  switch (format) {
    case 'datetime':
      options.year = 'numeric';
      options.month = '2-digit';
      options.day = '2-digit';
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.second = '2-digit';
      break;
    case 'date':
      options.year = 'numeric';
      options.month = '2-digit';
      options.day = '2-digit';
      break;
    case 'time':
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.second = '2-digit';
      break;
  }
  
  return timestamp.toLocaleString('zh-CN', options);
}

/**
 * 计算时间差（毫秒）
 */
export function calculateTimeDifference(startTime: Date, endTime: Date): number {
  if (!isValidDate(startTime) || !isValidDate(endTime)) {
    return 0;
  }
  
  return endTime.getTime() - startTime.getTime();
}

/**
 * 格式化持续时间
 */
export function formatDuration(durationMs: number): string {
  if (durationMs <= 0) {
    return '--';
  }
  
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}天${hours % 24}小时`;
  } else if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
}