# 云函数 - 微信支付

本目录包含微信支付相关的 CloudBase 云函数。

## 云函数列表

| 云函数         | 用途                        | 超时时间 |
| -------------- | --------------------------- | -------- |
| `wxpay-order`  | 创建支付订单 + 查询订单状态 | 30s      |
| `wxpay-notify` | 接收微信支付异步回调通知    | 10s      |

## 环境变量配置

在 [CloudBase 控制台 - 云函数](https://tcb.cloud.tencent.com/dev?envId=yunlefun-8g7ybcxc7345c490#/scf) 中，分别点击两个云函数进入详情页，在「函数配置」中设置环境变量。

### wxpay-order 环境变量

| 变量名           | 说明                     | 获取方式                                                                                                        |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `WX_MCH_ID`      | 微信支付商户号           | [微信支付商户平台](https://pay.weixin.qq.com/) → 账户中心 → 商户信息 → 商户号                                   |
| `WX_APPID`       | 微信应用 AppID           | 使用 **云乐坊工作室服务号**：`wxe6749827b67dfc25`（网站应用不支持绑定微信开放平台，需使用已认证服务号的 AppID） |
| `WX_SERIAL_NO`   | API 证书序列号           | 见下方「API 证书获取步骤」第 4 步                                                                               |
| `WX_PRIVATE_KEY` | API 证书私钥（PEM 格式） | 见下方「API 证书获取步骤」第 3 步                                                                               |
| `WX_APIV3_KEY`   | APIv3 密钥（32 字节）    | 见下方「APIv3 密钥获取步骤」                                                                                    |
| `WX_NOTIFY_URL`  | 支付回调通知地址         | 见下方「回调地址获取」                                                                                          |

### wxpay-notify 环境变量

| 变量名         | 说明                  | 获取方式                  |
| -------------- | --------------------- | ------------------------- |
| `WX_APIV3_KEY` | APIv3 密钥（32 字节） | 与 wxpay-order 中的值相同 |

---

## 参数获取指南

### 1. 商户号 (WX_MCH_ID)

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 点击 **账户中心** → **商户信息**
3. 页面顶部显示的 **商户号**（10 位数字），即为 `WX_MCH_ID`

> 如果还没有商户号，需要先在 [微信支付](https://pay.weixin.qq.com/index.php/apply/applyment_home/guide_normal) 完成商户入驻申请。

### 2. 微信应用 AppID (WX_APPID)

当前项目使用 **云乐坊工作室服务号** 的 AppID：

```
wxe6749827b67dfc25
```

> ⚠️ **为什么不用微信开放平台的网站应用 AppID？**
> 本网站不支持绑定微信开放平台的网站应用，因此 CloudBase 微信支付的 `WX_APPID` 需要使用已认证服务号的 AppID。服务号支持 JSAPI 支付和 Native 支付。

> ⚠️ AppID 必须与商户号进行关联。在商户平台 → 产品中心 → AppID 账号管理中添加绑定 `wxe6749827b67dfc25`。

### 3. API 证书 (WX_SERIAL_NO + WX_PRIVATE_KEY)

API 证书用于微信支付 V3 接口的请求签名。

#### 获取步骤

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 点击 **账户中心** → **API 安全** → **API 证书**
3. 点击 **申请证书**，按提示下载证书工具并生成证书
4. 生成后会得到以下文件：
   - `apiclient_key.pem` — **私钥文件**，即 `WX_PRIVATE_KEY` 的值
   - `apiclient_cert.pem` — 证书文件
   - `apiclient_cert.p12` — PKCS12 格式证书
5. 证书的 **序列号** 可在商户平台 API 证书页面查看，即 `WX_SERIAL_NO` 的值

#### 配置 WX_PRIVATE_KEY 的格式

将 `apiclient_key.pem` 文件的 **完整内容** 粘贴为环境变量值，包括首尾行：

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhki...
...
-----END PRIVATE KEY-----
```

> 如果控制台环境变量不支持多行，可将换行符替换为 `\n`，代码中已处理了这种情况：
>
> ```
> -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhki...\n...\n-----END PRIVATE KEY-----
> ```

### 4. APIv3 密钥 (WX_APIV3_KEY)

APIv3 密钥用于解密微信支付回调通知中的加密数据。

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 点击 **账户中心** → **API 安全** → **APIv3 密钥**
3. 点击 **设置密钥**，输入一个 **32 字节的字符串**（可自行生成随机字符串）
4. 妥善保存该密钥，它只会展示一次

> 可使用以下命令生成 32 位随机密钥：
>
> ```bash
> openssl rand -hex 16
> ```

### 5. 支付回调通知地址 (WX_NOTIFY_URL)

`wxpay-notify` 云函数已配置了 HTTP Access，回调地址格式为：

```
https://<envId>.service.tcloudbase.com/wxpay-notify
```

对于当前环境，即：

```
https://yunlefun-8g7ybcxc7345c490.service.tcloudbase.com/wxpay-notify
```

> ⚠️ 请在 [CloudBase 控制台 - 云函数](https://tcb.cloud.tencent.com/dev?envId=yunlefun-8g7ybcxc7345c490#/scf) 中确认 `wxpay-notify` 的 HTTP 触发路径，确保与此 URL 一致。

---

## 商户平台配置清单

除了云函数环境变量，还需要在微信支付商户平台完成以下配置：

### 1. 关联 AppID

- 商户平台 → **产品中心** → **AppID 账号管理** → 添加 AppID 并确认关联

### 2. 开通支付产品

根据需要的支付方式，在商户平台开通对应产品：

| 支付方式           | 产品名称    | 开通路径                          |
| ------------------ | ----------- | --------------------------------- |
| Native 扫码        | NATIVE 支付 | 产品中心 → 我的产品 → Native 支付 |
| JSAPI（微信内）    | JSAPI 支付  | 产品中心 → 我的产品 → JSAPI 支付  |
| H5（微信外浏览器） | H5 支付     | 产品中心 → 我的产品 → H5 支付     |

> **注意**：H5 支付默认关闭，需在 `.env` 中设置 `NUXT_PUBLIC_ENABLE_H5_PAY=true` 开启。开启前需先在商户平台完成 H5 支付产品申请。

### 3. 配置支付授权目录（JSAPI 支付）

- 商户平台 → **产品中心** → **开发配置** → **支付授权目录**
- 添加你的网站域名，如 `https://www.yunle.fun/`

### 4. 配置 H5 支付域名（H5 支付，可选）

- 商户平台 → **产品中心** → **开发配置** → **H5 支付域名**
- 添加你的网站域名，如 `https://www.yunle.fun`

---

## 部署命令

云函数已部署到 CloudBase。如需重新部署，可使用 CloudBase CLI：

```bash
# 安装 CLI
npm i -g @cloudbase/cli

# 登录
tcb login

# 部署单个云函数
tcb functions deploy wxpay-order --envId yunlefun-8g7ybcxc7345c490
tcb functions deploy wxpay-notify --envId yunlefun-8g7ybcxc7345c490
```

或在项目根目录执行：

```bash
tcb functions deploy --envId yunlefun-8g7ybcxc7345c490
```

## 数据库

支付订单存储在 CloudBase NoSQL `orders` 集合中，已创建以下索引：

| 索引名              | 字段                       | 唯一性 |
| ------------------- | -------------------------- | ------ |
| `idx_outTradeNo`    | `outTradeNo` ASC           | 唯一   |
| `idx_userId_status` | `userId` ASC, `status` ASC | 非唯一 |

安全规则：用户只能读取自己的订单（`auth.uid == doc.userId`），不可直接写入。

[查看 orders 集合 →](https://tcb.cloud.tencent.com/dev?envId=yunlefun-8g7ybcxc7345c490#/db/doc/collection/orders)
