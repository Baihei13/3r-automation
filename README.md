# 3r自动化

Foundry VTT v14 / D35E 3.1.0 的3R与PF1规则自动化及配套世界时间界面。

| 目录 | 模块 | 版本 |
| --- | --- | --- |
| samson-3r-automation | 3r自动化 | 0.4.13 |
| d35e-world-timeline | 3R 世界时间轴 | 0.7.5 |
| three-r-combat-hud | 3r战斗HUD | 0.5.1 |

这是仅含规则的公开源码版。没有角色原卡、人物背景、完整角色预设、原卡图片、规则书CHM、世界数据库或系统安装文件。能力正文独立保存在 rules-content.zh.json；法术译文保存在 spell-descriptions.zh.json。内部模块ID保留，旧世界引用不改名。

## 2026-10-03 源码更新

本次更新自动化0.4.13和时间轴0.7.5，HUD保持0.5.1。自动化补充通用法术、条件检定、原生状态同步、CL与增益到期处理；命令术仍由使用者手动处理。时间轴补入整轮6秒、换行动者不推进秒数、队伍休息和真实原生增益展示修复。

此次为Git源码推送，尚未制作这两个新版的Release和安装包。下面的latest清单目前仍安装自动化0.4.10和时间轴0.7.2；源文件清单不保留指向旧ZIP的download字段，避免把旧包当成新版。HUD独立安装地址保持0.5.1。

源码阅读和公开范围核对已完成；没有运行测试、语法检查、客户端、浏览器或游戏验证。新版本实际安装、加载和效果由使用者反馈。

## 安装（已发布安装包）

新增独立[3r战斗HUD](three-r-combat-hud/README.md)0.5.1，独立发布标签为hud-v0.5.1。HUD包含八套自写CSS主题（P5风格黑红、2077风格黄黑、玻璃/奇幻/羊皮纸等），没有第三方主题文件/纹理或角色原卡/人物素材。安装包发布不代表游戏验证。

在Foundry设置页打开“附加模块 → 安装模块”，分别把下面地址填入“清单URL”：

| 模块 | 清单URL |
| --- | --- |
| 3r自动化 | https://github.com/Baihei13/3r-automation/releases/latest/download/samson-3r-automation.module.json |
| 3R 世界时间轴 | https://github.com/Baihei13/3r-automation/releases/latest/download/d35e-world-timeline.module.json |
| 3r战斗HUD 0.5.1 | https://github.com/Baihei13/3r-automation/releases/download/hud-v0.5.1/three-r-combat-hud.module.json |

安装后在D35E世界启用相应模块；更新后GM与玩家刷新各自客户端。公开版建立“3r自动化 → 来源书 → 类别”合集，不自动创建角色。由使用者创建自己的角色，拖入需要的条目并配置法术书和其他角色选项。

也可从[发布页](https://github.com/Baihei13/3r-automation/releases/tag/v0.4.10)下载两个独立安装包，分别解压到对应模块目录。每个ZIP根目录直接包含module.json及scripts/styles/data等本模块文件。仓库源码ZIP用于手动复制两个模块目录，不作为Foundry清单URL。

## 主要内容

0.4.10修复公开版安装时的“STARTING_KNOWLEDGE is not defined”：修道牧师的本职知识技能独立按D35E字段列出，不再引用角色起始技能变量。0.4.9公开版遗漏该变量导入，生成修道牧师合集条目时中断。更新后由GM重新进入世界，原安装流程按模块条目标识补齐未完成的合集，不重建角色或分配技能级数。实际新电脑安装恢复仍待用户验证。

0.4.9已上传到本仓库main分支，可下载仓库ZIP手动安装。该版细化夹击失败说明，分别记录同伴、武器、距离、长触及最小范围、行动能力及墙壁阻挡。鸦嘴战锤是长触及近战武器，中型角色通常不能靠它威胁相邻5尺目标。用户确认此次长触及疑问源于误测；这项确认不代表全部规则及多人边界已经验收。

中文规则合集、原生条目分类/前提与加值叠加、施法与增益到期、武器娴熟、方格夹击与武器偷袭、易碎/黑曜石处理、可选0环无限；配套时间轴包含时间、效果展示、日历、天气、导入导出及战斗界面。

**源码已制作，未运行测试、语法检查、Foundry或浏览器验证。** 0.4.6包含武器娴熟的实际掷骰入口、旧默认职业偷袭公式修复及相邻对角距离修复。友善标记只识别同伴，夹击仍要求双方能够威胁目标。缺少视野、非常规触及或特殊规则时会显示待GM裁定，不宣称全部自动化已完成。

0.4.9包含0.4.7–0.4.8的修复：修正v14只读模板接口及侦测模式读取，补入普通照明检测，保留独立成立的夹击；移除新增判定面板及下拉框，自动夹击回填原有勾选，手动指定仍检查其他偷袭条件。程序错误明确报告，聊天保存本次判定。

- [模块说明](samson-3r-automation/README.md)
- [加值规则](samson-3r-automation/BONUS-RULES.md)
- [项目约定](samson-3r-automation/PROJECT-CONTRACT.md)
- [续接记录](samson-3r-automation/NEXT.md)
- [覆盖与缺口](samson-3r-automation/COVERAGE.md)
- [时间轴说明](d35e-world-timeline/README.md)

原规则与译文的权利归各自作者/出版方；本仓库未自行授予这些资料新的许可。PF2只作代码/界面参考，不作3R/PF1规则来源。

## 后续发布

自动化/时间轴联合发布同时附上两个模块的命名清单与各自ZIP，其manifest指向latest、download指向固定发布标签。HUD使用独立hud-v版本标签，不设为仓库Latest，避免影响上述安装地址；HUD后续更新清单为main分支的three-r-combat-hud/module.json，download指向固定HUD标签。安装包从公开仓库的指定提交生成，禁止从私有本地模块目录直接打包。上传、清单/文件目录核对与用户实际Foundry安装验收分别记录。
