# 3r自动化

Foundry VTT v14 / D35E 3.1.0 的3R与PF1规则自动化及配套世界时间界面。

| 目录 | 模块 | 版本 |
| --- | --- | --- |
| samson-3r-automation | 3r自动化 | 0.4.6 |
| d35e-world-timeline | 3R 世界时间轴 | 0.7.2 |

这是仅含规则的公开源码版。没有角色原卡、人物背景、完整角色预设、原卡图片、规则书CHM、世界数据库或系统安装文件。能力正文独立保存在 rules-content.zh.json；法术译文保存在 spell-descriptions.zh.json。内部模块ID保留，旧世界引用不改名。

## 安装

1. 下载仓库ZIP或克隆仓库。
2. 把两个模块目录完整放入Foundry用户数据目录的 Data/modules/，目录内直接包含 module.json。
3. 在D35E世界启用模块，更新后GM与玩家刷新各自客户端。
4. 公开版建立“3r自动化 → 来源书 → 类别”合集，不自动创建角色。由使用者创建自己的角色，拖入需要的职业、种族、专长、法术与装备，选择法术书职业链接及其他角色选项。

当前没有Foundry安装清单链接或Release下载包，仓库ZIP用于手动安装。

## 主要内容

中文规则合集、原生条目分类/前提与加值叠加、施法与增益到期、武器娴熟、方格夹击与武器偷袭、易碎/黑曜石处理、可选0环无限；配套时间轴包含时间、效果展示、日历、天气、导入导出及战斗界面。

**源码已制作，未运行测试、语法检查、Foundry或浏览器验证。** 0.4.6包含武器娴熟的实际掷骰入口、旧默认职业偷袭公式修复及相邻对角距离修复。友善标记只识别同伴，夹击仍要求双方能够威胁目标。缺少视野、非常规触及或特殊规则时会显示待GM裁定，不宣称全部自动化已完成。

- [模块说明](samson-3r-automation/README.md)
- [加值规则](samson-3r-automation/BONUS-RULES.md)
- [项目约定](samson-3r-automation/PROJECT-CONTRACT.md)
- [续接记录](samson-3r-automation/NEXT.md)
- [覆盖与缺口](samson-3r-automation/COVERAGE.md)
- [时间轴说明](d35e-world-timeline/README.md)

原规则与译文的权利归各自作者/出版方；本仓库未自行授予这些资料新的许可。PF2只作代码/界面参考，不作3R/PF1规则来源。
