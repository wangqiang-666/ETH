# OKX 代理端点策略与运维说明

本文件记录当前 OKX 代理（okx-proxy）针对常用公共端点的“限速 / 微缓存 / 节流 / 重试”策略设计与验证方法，并说明私有接口的处理方式与安全注意事项。

更新时间：自动生成于本地，后续如策略调整，请一并更新本文档。

---

一、背景与目标
- 对公共 REST 接口依据文档限速规则，加入：
  - 微缓存（microcache）以降低相同请求的上游压力
  - 客户端 IP 维度节流（令牌桶）以避免触发 429
  - 上游拥塞/限速（429/5xx）时的指数退避与短期冷却
- 对私有 REST 接口：默认仅透传，不在代理侧保存密钥或代签（后续若启用签名代理，再增加安全密钥管理与签名流程）

二、公共/私有接口判定
- 判定规则：是否包含 OK-ACCESS-KEY 请求头
  - 无 OK-ACCESS-KEY：视为公共接口，可应用公共端点策略与缓存
  - 有 OK-ACCESS-KEY：视为私有接口，默认仅透传，不修改或记录敏感头

三、端点策略映射（首批）
1) GET /api/v5/public/time
- 上游限速（按 IP）：10 次 / 2s
- 微缓存：800ms
- 节流：客户端 IP 维度令牌桶（10/2s，突发 10）
- 重试：429/5xx 指数退避，起始 500ms，上限 2~4s（当前实现为 0.5s 起、逐步翻倍至 4s 内）
- 安全：剥离 OK-ACCESS-* 请求头（公共接口不应带密钥）

2) GET /api/v5/system/status
- 上游限速（按 IP）：1 次 / 5s
- 微缓存：5s（避免频繁打上游，健康检查建议使用本地 /health）
- 节流：客户端 IP 维度令牌桶（1/5s，突发 1）
- 重试：同上（429/5xx 指数退避）
- 安全：剥离 OK-ACCESS-* 请求头

3) 常见行情接口（预置默认）
- GET /api/v5/market/tickers?instType=...
  - 微缓存：500ms
  - 节流：40/2s（IP 维度）
- GET /api/v5/market/candles?...
  - 微缓存：800ms
  - 节流：10/2s（IP 维度）
- GET /api/v5/(public|market)/instruments?...
  - 微缓存：2000ms
  - 节流：10/2s（IP 维度）

说明：以上为稳妥默认值，后续可根据访问规模和 OKX 文档的更细粒度（如 instrument、userId 维度）进一步精调。

四、响应头与行为
- X-Proxy-Policy: <policy-name>
  - 表示命中的策略名（如 public-time、system-status）
- X-Proxy-Cache: HIT | MISS | STALE
  - HIT：命中代理微缓存
  - MISS：未命中（直连上游）
  - STALE：上游被限速或拥塞时，回退返回旧缓存
- Retry-After: <seconds>
  - 当触发代理侧节流（429）时带上，提示客户端等待时间

五、错误与重试策略
- 适用状态：429 / 5xx
- 策略：指数退避（如 500ms 起，每次翻倍，最大 2~4s），最多重试 1~2 次；超过则返回上游响应或 502（Bad Gateway）。
- 没有显式 Retry-After 时，采用保守退避窗口。

六、私有接口处理与安全
- 默认行为：仅透传，不在代理侧存储或使用任何 OK-ACCESS-* 密钥与签名信息。
- 后续如需“代理侧签名”：需配套安全密钥管理（环境变量/密钥管理服务、最小可见性、零日志敏感信息）、严格访问控制与审计。

七、验证步骤（curl 示例）
1) 验证 /api/v5/public/time（多次请求观察缓存与节流）
- 预期：第一次 MISS，随后短时间内出现 HIT；如果短时间高并发超过限额，返回 429 且带 Retry-After

curl -sS -m 6 -D - -o /dev/null http://127.0.0.1:8080/api/v5/public/time | egrep -i "^(HTTP/|X-Proxy-Policy:|X-Proxy-Cache:|Retry-After:)"

2) 验证 /api/v5/system/status（受 5s 冷却）

curl -sS -m 6 -D - -o /dev/null http://127.0.0.1:8080/api/v5/system/status | egrep -i "^(HTTP/|X-Proxy-Policy:|X-Proxy-Cache:|Retry-After:)"

3) 本地健康检查（不打上游）

curl -sS -m 3 -D - -o /dev/null http://127.0.0.1:8080/health

4) 观察 pm2 日志（是否有 429/退避、缓存命中日志）

pm2 logs okx-proxy --lines 80 --nostream

八、运维与回滚
- 代码路径：/root/okx-proxy.js（远端香港服务器）
- 进程管理：pm2（进程名：okx-proxy）
- 更新过程：先备份再热重载 pm2 reload okx-proxy（必要时 pm2 restart）
- 回滚：将 /root/okx-proxy.js 恢复为备份版本（/root/okx-proxy.js.bak.<timestamp>），然后 pm2 reload

九、扩展与后续计划
- 根据 OKX 文档完善更多端点的精细化限速维度（如按 instrument、userId）
- 针对高频端点以业务特征（query 参数）细分缓存键，提升缓存命中
- 观察内存占用与命中率，必要时将 microcache 从 Map 替换为 LRU 容器并限制条目数
- 若未来启用签名代理：增加安全密钥管理、请求签名中间件与权限隔离

—— 以上 ——