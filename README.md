# API Token Usage

一个轻量级 VS Code 扩展，用于查询兼容接口的 API Token 用量，并在状态栏显示剩余额度。

默认适配以下接口：

```http
GET https://ctapi.csxdtx.com:16000/api/usage/token
Authorization: Bearer <API_KEY>
Accept: application/json
```

扩展只负责额度查询，不接管 VS Code Copilot、Custom Endpoint 或模型请求。

## 功能

- 在 VS Code 状态栏显示剩余额度
- 定时自动刷新
- 点击状态栏查看详细数据
- 手动刷新用量
- 使用 VS Code `SecretStorage` 安全保存 API Key
- 支持自定义服务地址、查询路径、刷新间隔和配额换算比例
- 支持无限额度令牌
- 请求超时和错误提示
- 可复制当前用量摘要

状态栏示例：

```text
$(credit-card) CTAPI $12.35
```

悬停或打开详情后可查看：

```text
计划：API Token
剩余：$12.3500
已使用：$3.2000
总额度：$15.5500
剩余比例：79.4%
更新时间：2026/8/3 11:00:00
```

## 接口返回格式

扩展兼容以下两种响应形式。

### 带 `data` 包装

```json
{
  "success": true,
  "data": {
    "name": "API Token",
    "total_available": 6175000,
    "total_used": 1600000,
    "total_granted": 7775000,
    "unlimited_quota": false
  }
}
```

### 直接返回用量对象

```json
{
  "name": "API Token",
  "total_available": 6175000,
  "total_used": 1600000,
  "total_granted": 7775000,
  "unlimited_quota": false
}
```

字段说明：

| 字段 | 必需 | 说明 |
|---|---:|---|
| `total_available` | 是 | 剩余配额单位，必须是数值 |
| `total_used` | 否 | 已使用配额单位，缺省按 `0` 处理 |
| `total_granted` | 否 | 总授予配额单位，缺省按 `0` 处理 |
| `name` | 否 | Token 或套餐名称 |
| `unlimited_quota` | 否 | 是否为无限额度 Token |
| `success` | 否 | 为 `false` 时按失败处理 |
| `code` | 否 | 为 `false` 时按失败处理 |
| `message` | 否 | 服务端错误信息 |

默认换算规则：

```text
500000 配额单位 = 1 USD
```

可通过设置 `apiTokenUsage.quotaPerDollar` 修改。

## 环境要求

- VS Code `1.100.0` 或更高版本
- Node.js 20 或更高版本
- npm

## 从源码安装

### 1. 克隆仓库

```powershell
git clone https://github.com/Hello-DaTang/API-Token-Usage.git
cd API-Token-Usage
```

### 2. 安装依赖

```powershell
npm install
```

### 3. 编译

```powershell
npm run compile
```

### 4. 调试运行

使用 VS Code 打开项目：

```powershell
code .
```

按 `F5` 启动 Extension Development Host。

在新窗口中按 `Ctrl+Shift+P`，执行：

```text
API Token Usage: 设置 API Key
```

### 5. 打包 VSIX

```powershell
npm run package
```

生成文件类似：

```text
api-token-usage-0.1.0.vsix
```

### 6. 安装 VSIX

命令行安装：

```powershell
code --install-extension .\api-token-usage-0.1.0.vsix
```

也可以在 VS Code 中操作：

1. 打开扩展面板
2. 点击右上角 `...`
3. 选择“从 VSIX 安装...”
4. 选择生成的 `.vsix` 文件

安装完成后建议执行：

```text
Developer: Reload Window
```

## 首次配置

按 `Ctrl+Shift+P`，执行：

```text
API Token Usage: 设置 API Key
```

API Key 会保存到 VS Code 的 `SecretStorage`，不会写入：

- `settings.json`
- 项目文件
- Git 仓库

注意：VS Code 每个扩展的 SecretStorage 相互隔离，本扩展无法直接读取 Copilot Custom Endpoint 已保存的 API Key，因此需要单独输入一次。

## 可用命令

| 命令 | 作用 |
|---|---|
| `API Token Usage: 设置 API Key` | 保存或替换 API Key |
| `API Token Usage: 刷新用量` | 立即请求最新用量 |
| `API Token Usage: 查看详情` | 查看当前用量和操作菜单 |
| `API Token Usage: 清除 API Key` | 删除已保存的 API Key |
| `API Token Usage: 打开设置` | 打开扩展设置 |

## 扩展设置

打开 VS Code 设置并搜索：

```text
API Token Usage
```

或者在 `settings.json` 中配置：

```json
{
  "apiTokenUsage.label": "CTAPI",
  "apiTokenUsage.baseUrl": "https://ctapi.csxdtx.com:16000",
  "apiTokenUsage.usagePath": "/api/usage/token",
  "apiTokenUsage.authorizationScheme": "Bearer",
  "apiTokenUsage.refreshMinutes": 5,
  "apiTokenUsage.quotaPerDollar": 500000,
  "apiTokenUsage.currencySymbol": "$",
  "apiTokenUsage.decimalPlaces": 2,
  "apiTokenUsage.timeoutSeconds": 15
}
```

### 设置项说明

| 设置项 | 默认值 | 说明 |
|---|---:|---|
| `apiTokenUsage.label` | `CTAPI` | 状态栏显示名称 |
| `apiTokenUsage.baseUrl` | `https://ctapi.csxdtx.com:16000` | API 服务根地址 |
| `apiTokenUsage.usagePath` | `/api/usage/token` | 用量查询路径，也可填写完整 URL |
| `apiTokenUsage.authorizationScheme` | `Bearer` | `Authorization` 认证方案；留空则直接发送 API Key |
| `apiTokenUsage.refreshMinutes` | `5` | 自动刷新间隔，单位为分钟 |
| `apiTokenUsage.quotaPerDollar` | `500000` | 每 1 USD 对应的配额单位 |
| `apiTokenUsage.currencySymbol` | `$` | 状态栏和详情中的货币符号 |
| `apiTokenUsage.decimalPlaces` | `2` | 状态栏保留的小数位数 |
| `apiTokenUsage.timeoutSeconds` | `15` | 请求超时时间，单位为秒 |

## 使用方式

设置 API Key 后，扩展会自动请求：

```text
{baseUrl}{usagePath}
```

例如：

```text
https://ctapi.csxdtx.com:16000/api/usage/token
```

状态栏项目支持以下操作：

- 单击：打开详情菜单
- 悬停：查看完整用量
- 详情菜单中选择“立即刷新”：重新请求服务端
- 详情菜单中选择“复制用量摘要”：复制当前用量文本

## 故障排查

### 状态栏显示“未配置”

执行：

```text
API Token Usage: 设置 API Key
```

### 返回 401 或 403

检查：

- API Key 是否正确
- Token 是否被禁用
- `authorizationScheme` 是否应为 `Bearer`
- 查询接口是否允许当前 Token 访问

### 提示 `total_available` 不存在

服务端响应必须包含数值型：

```json
{
  "total_available": 123456
}
```

或者：

```json
{
  "data": {
    "total_available": 123456
  }
}
```

### 请求超时

增大：

```json
{
  "apiTokenUsage.timeoutSeconds": 30
}
```

并检查中转站、反向代理和网络连接。

### 金额显示不正确

确认实际换算比例，再修改：

```json
{
  "apiTokenUsage.quotaPerDollar": 500000
}
```

换算公式：

```text
金额 = 配额单位 / quotaPerDollar
```

## 开发命令

```powershell
# 编译
npm run compile

# 持续监听编译
npm run watch

# 仅类型检查
npm run check

# 打包 VSIX
npm run package
```

## 安全说明

- API Key 使用 VS Code SecretStorage 保存
- 扩展不会将 API Key 输出到日志
- 扩展不会将 API Key写入工作区配置
- 请求只发送到你配置的用量接口
- 发布或截图前仍应检查终端和调试日志中是否包含敏感数据

## License

MIT
