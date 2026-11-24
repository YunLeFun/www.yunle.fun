# 云食册 Google Play 会员

Play 版使用独立的 `cook-play-order` CloudBase Event Function。正式账本复用 `orders` 和 `user_memberships`，登录同一个云乐坊账号即可读取 Web、iOS 和 Android 的会员有效期。单次月付、年付分别选用候选商品 `cook_member_month`、`cook_member_year`，购买选项 ID 为 `buy`，每笔仅允许购买一份。商品、价格与分发地区仍需在 Play Console 配置。

## Android 调用契约

所有请求使用 CloudBase 已登录 Bearer 会话。函数从可信调用上下文取得 UID，并核查账号状态。

| 操作                 | 额外请求字段                                                           | 响应                                                                                                            |
| -------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `getCapabilities`    | 无                                                                     | `accountMarker`、`products[{id, cycle, purchaseOptionId}]` 和可选的 `subscriptions[{id, cycle, basePlanId}]`    |
| `preparePurchase`    | `productId`，订阅另带 `basePlanId`，切换方案附 `replacesPurchaseToken` | 原请求方案和已登记的 `accountMarker`。核实原订阅后，方案切换另外返回 `replacementMode: "WITHOUT_PRORATION"`     |
| `verifyPurchase`     | `purchaseToken`                                                        | `productId`、`purchaseReference`（购买令牌的 SHA-256）和 `status`                                               |
| `verifySubscription` | `purchaseToken`                                                        | `productId`、`basePlanId`、`cycle`、`purchaseReference`、`state`、`autoRenewing`、`periodExpiresAt` 和 `status` |
| `getEntitlement`     | 无                                                                     | 当前账本中该账号的 `membership.isActive` 和毫秒时间戳 `membership.expireAt`                                     |

成功响应均带 `application: "cook"`、`packageName: "fun.yunle.cook"` 和明确的 `ledgerEnvironment`（`Production` 或 `Sandbox`）。失败响应只带业务 `code`。请求只提交 Play 购买令牌，商品、付款时间、归属及测试标签均来自 Google 回查。

- `pending` 或 `cancelled` 表示 Play 未完成购买，服务端不发放会员。
- `committed` 表示订单和会员时长已在一个事务中提交，Play 确认仍需重试。客户端随后可用同一令牌补交。
- `confirmed` 表示服务端账本和 Play 消费均已确认。客户端随后刷新会员有效期。

单次购买提交后按原会员自然月或年续期。重复或并发提交只发放一次。已被 Google 消费的令牌须匹配已有发放凭据，避免重新发放。消费由服务端在事务提交后执行。新设备可通过账号查询恢复已消费的购买。尚未消费的订单可从 Play 已拥有商品恢复并重交。 [商品回查](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2/getproductpurchasev2) [确认并消费](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/consume)

## 打包与测试

运行 `node scripts/package-cook-play-order.mjs <新输出目录>` 可生成 `cook-play-order`、`cook-play-notify`、`cook-play-refresh` 及各自的 `-sandbox` 包。入口为 `index.main`。订单和通知使用 `Nodejs18.15` Event Function。给 `cook-play-notify` 和 `cook-play-notify-sandbox` 分别绑定 HTTP 访问路由，保留 Pub/Sub 的 `Authorization` 请求头。输出目录的 `cloudbaserc.json` 提供两份回查函数的 `Nodejs20.19` Event Function 与定时触发配置。

正式入口复用 `orders` 和 `user_memberships`，另使用仅服务端可写的 `play_purchase_owners`、`play_purchase_states` 和 `play_subscription_progress`。Sandbox 对应五个集合均带 `play_sandbox_` 前缀，Google 回查也必须返回 Play 测试标签。两个购买入口按登录身份配置，HTTP 通知入口按 Pub/Sub 推送身份配置。

入口默认停用。服务端配置包括 `COOK_PLAY_BILLING_ENABLED`、`COOK_PLAY_SERVICE_ACCOUNT_JSON`、`COOK_PLAY_ACCOUNT_KEY` 和 `ACCOUNT_API_INTERNAL_TOKEN`。同一账本的订单、通知与回查函数共用相同的账号标记密钥。Sandbox 还需 `COOK_PLAY_SANDBOX_UIDS` 白名单。账号标记密钥用于绑定购买和恢复，需长期保存。仅服务端可访问支付凭据。

## 延迟付款和退款

Play Console 开启单次商品通知。Pub/Sub 为正式及 Sandbox 各配置认证推送订阅，限制主题发布者为 Google Play。通知函数按 `COOK_PLAY_PUSH_SUBSCRIPTION`、`COOK_PLAY_PUSH_AUDIENCE` 和 `COOK_PLAY_PUSH_SERVICE_ACCOUNT` 校验订阅、令牌受众与已验证的推送账号。通知的退款与结算状态不会跨账本。 [Pub/Sub 认证推送](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions)

Android 在付款页打开前登记购买账号。付款通知回查 Google 的已购状态和账号标记，在 App 进程已经退出时仍可发放并消费订单。等待付款或暂时无法确认的通知返回非成功状态，由 Pub/Sub 再投递。收到全额撤销通知时按原订单号和令牌摘要核对，订单状态与会员有效期同事务更新。退款早于验单时记录撤销状态，后续的旧验单结果不能恢复已退款权益。若会员后来已续费，订单记录 `refundEntitlementStatus: "manual_review_required"` 并保留当前有效期。 [RTDN 通知类型](https://developer.android.com/google/play/billing/rtdn-reference)

上线验收需要配置上述函数、集合权限和两个订阅，在测试账本验证真实 CloudBase 事务与 Google 测试单，核对购买、取消、换号、进程退出、恢复、退款和重复通知。本地验证覆盖 API 契约、内存事务和实际打包入口。

## 自动续费

预定商品 `cook_member_subscription` 使用同一订阅的 `monthly`、`yearly` 两个自动续费基本方案。Android 展示 Play 本地化价格，并通过 Play 订阅中心管理扣款及取消续订。Play Console 仍需配置实际商品和地区。

服务端从订阅回查获得账号绑定和最新成功订单编号，再向 Orders API 逐笔核对相同购买令牌的付款。续费订单号单独记账，遗漏的付费周期按顺序补账，只有首次付款入账后才确认订阅。零元恢复确认单只更新进度，已经支付的时长保留。全额退款按订单回退，遇到后续独立付款则保留权益并标记人工核对。 [Play 订阅生命周期](https://developer.android.com/google/play/billing/lifecycle/subscriptions) [Play 订单接口](https://developers.google.com/android-publisher/api-ref/rest/v3/orders)

Google 已核实的访问期限保存在 `user_memberships.playSubscriptionAccess`，按原购买记录独立更新。账号接口、收藏与历史同步、会员 AI 和云空间使用有效访问期限。`getMembership` 同时提供已付款的 `expireAt` 和较晚的 `accessExpireAt`。共享会员按云乐坊的自然月或年顺延，从已有已付款到期时间和 Play 订单服务期起点中取较晚者。宽限期内补扣时，订单仍记录实际扣款时间。欠费暂停、到期或对应全额退款会清除该订阅的临时访问，其他已付款时长仍可使用。若自动回退会恢复一笔已退款的订单，则标记人工核对。

月付和年付互换使用 `WITHOUT_PRORATION`，下次 Play 扣款按新方案。服务端校验 Google 返回的新旧购买令牌关联和账号，承接已付周期的访问期限，并停止旧令牌的定时回查。零元换方案只更新订阅状态，后续实际付款才顺延会员时长。原订单退款时清除从该订单承接的临时访问。 [Play 切换订阅方案](https://developer.android.com/google/play/billing/subscriptions#replacement-modes)

订阅购买、通知和定时回查使用 `COOK_PLAY_SUBSCRIPTIONS_ENABLED` 开关，默认关闭。验收前需要让账号接口、Cook 同步与云空间读取端先支持临时访问字段。真实换方案和续费交易待 Sandbox 联调。

### 静默宽限期回查

回查函数每分钟检查到期任务。给两个账本的 `play_subscription_progress` 对应集合添加 `nextRefreshAt` 升序索引。函数使用定时触发，关闭客户端调用权限。购买令牌以每个账本分别派生的 AES-256-GCM 密钥封装，关联到原令牌摘要。Google 确认订阅结束或令牌超过回查期限时，服务端清除密文。任务中断会在短暂占用期后重新领取，Google 暂时不可用时会退避重试。 [CloudBase 定时触发器](https://docs.cloudbase.net/cloud-function/timer-trigger)

到续费日后，如果 Google 最新状态仍为 `ACTIVE` 且账期尚未更新，经过原订单核对的临时访问保留至后续回查窗口结束。新扣款仍需取得实际付款凭据才会顺延会员时长。定时任务延迟或 Google 暂不可用时，用户可能短暂看不到续期权益。Play 发布前应在 Sandbox 核对定时器、索引、账号与实际账单行为。 [Play 静默宽限期](https://developer.android.com/google/play/billing/lifecycle/subscriptions#silent-grace-period)
