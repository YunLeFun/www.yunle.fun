# 云朵成就 · 第一版

跟踪：[www #143](https://github.com/YunLeFun/www.yunle.fun/issues/143)。

## 体验与设计

目标：让云乐坊账号收集具有不同气象和性格的云朵，并选择一朵在个人主页佩戴。

沿用官网晴空、蓬松云和柔和配色，复用 `CuteCloud`、`AppSection`、现有圆体标题和正文 token。颜色使用现有天空蓝、晨光黄、珊瑚与青色；星尘和极光沿用已确认的概念配色。保留现有深浅主题和设计系统字体，不另设全局视觉规则。

个人中心增加“我的天空”：上方展示佩戴云与收藏数量，下方为成就列表。窄屏两列、桌面三列；每项展示云、名称、条件、进度与佩戴操作。公开主页展示已解锁收藏及当前佩戴，不公开行为明细。列表保持静止，点击预览时短暂播放专属效果；减少动态效果时只保留静态表现。

组件边界：

- `AchievementCloud`：输入 effect / active，绘制云朵及短暂效果。
- `CloudAchievementCollection`：输入 collection / editable / loading / saving / error，展示收藏并发出 equip / refresh。
- `MyCloudAchievements`：编排本人数据加载、保存、失败反馈。
- `CloudAchievementSession`：登录就绪后初始化，签到成功后刷新。
- `useCloudAchievements`：账号隔离、请求排序、服务端状态和事件上报。
- `useCloudAchievementDisplay`：只读当前账号的收藏与佩戴，不加载 SDK 或额外请求。
- `MemberAvatar`：接收头像主人的 `equippedCloud`，在头像右上侧展示同款小云，与右下侧会员标记共存。
- `SkyHero` / `CloudAchievementSky`：接收 `cloudEffect`，绘制对应的顶部主云与天空氛围。其他页面不传此属性时保持默认天空。

个人中心、公开主页和账户菜单的头像展示当前佩戴云朵。个人中心佩戴保存成功后，头像、导航和顶部天空同时更新；保存失败继续显示上一次已保存的佩戴。摘下后清除挂件并恢复默认天空。访问他人主页时使用主页主人的公开收藏，避免把访问者的佩戴带入对方主页。

天空配色以蓝色 `#234b85` / `#73b9e9`、棉白 `#d5e7f5`、珊瑚 `#edaaa1`、晨光 `#ffd782`、极光紫 `#afa0e4` 为基础，沿用现有字体和白字压暗层。各主题通过主云外观、静态彩虹、星点或极光区分；不增加常驻动画，减少动态效果设置继续生效。

## 首版规则

| 云朵   | 条件                  | 效果     |
| ------ | --------------------- | -------- |
| 初见云 | 首次登录              | 白云微笑 |
| 棉花云 | 戳云 10 次            | 小云跟班 |
| 彩虹云 | 戳云 50 次            | 彩虹展开 |
| 星尘云 | 戳云 100 次           | 星光闪烁 |
| 朝霞云 | 累计签到 7 天         | 太阳探头 |
| 落日云 | 累计签到 30 天        | 暖色晚霞 |
| 极光云 | 探索 3 款不同公开应用 | 青紫极光 |

首次初始化自动佩戴初见云，之后完全由用户选择，支持摘下。签到不要求连续，旧账号可按服务端已有累计签到记录补发；旧浏览器的匿名戳云数不迁入账号。

## 数据与接口

后端唯一实现：`YunLeFun/api/cloudfunctions/account-api/cloud-achievements.js`。

- `getMyCloudAchievements`：需登录；初始化收藏，按服务端签到总数补齐解锁。
- `recordCloudAchievementEvent`：需登录；`poke` 携带单次 eventId，`explore` 携带真实公开应用的不可变 appId。
- `equipCloudAchievement`：需登录；achievementId 必须为本人已解锁云或 null。
- 公开 `getProfile` 增加 cloudAchievements，仅返回已解锁收藏、佩戴及公开成就元数据，不返回事件去重键或浏览明细。

`user_cloud_achievements` 以 uid 为文档主键，权限 ADMINONLY。事务写入、保留首次解锁时间，重复事件不累计；戳云明细最多 100 个、探索明细最多 3 个。客户端既不提交 userId，也不提交累计值或解锁时间。戳云与探索属于自报的装饰性互动，不证明真实使用时长，不用于发币或权益判断。账号注销时清理本集合。

## 发布与验收

1. 在目标 CloudBase 环境创建 `user_cloud_achievements`，设置 ADMINONLY。资源声明在 API 模块的 `CLOUD_ACHIEVEMENTS_RESOURCE`；仅需默认主键索引。
2. 从 API 仓库验证并部署 account-api，保持既有配置与密钥；确认新 action 可用。
3. 发布官网，验证真实账号：登录、戳云解锁、佩戴、刷新、换设备、摘下、账号切换、访客访问公开主页。
4. 验证重复事件、并发更新、未解锁佩戴、失败重试和减少动态效果。

源码和本地测试完成不代表已经上线；发布和真实环境验收仍由 issue 单独跟踪。
