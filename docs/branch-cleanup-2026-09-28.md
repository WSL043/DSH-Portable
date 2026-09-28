# Completed candidate branch cleanup

Native 0.7.8 already ships official rc.2 (`44677d8`) and reviewed stable default plugins. PR #150 repeated the same core identity because preview discovery compared only its older preview lock. Discovery now also reads the stable lock as a lower bound; already shipped candidates do not create another review, but newer releases remain eligible and same-version integrity drift fails closed. This does not change any product/core lock or promote the older preview plugin combination.

`qualification/rc2-office` (`da9cb4a41c57ef1c7e933c423cfa551619aa547c`) retains historical rc.2 qualification, Office dependency work and beta plugin pins. Relevant qualification evidence already lives in `upstream-0.1.7-rc.2-intake.md`; its remaining lock differences are not a new product upgrade. Preserve its exact history as tag `archive/qualification-rc2-office-20260928`, then remove the inactive branch. Close duplicate PR #150 and remove its automation branch. The monitor may create a new short-lived review branch only when an actually newer unshipped candidate arrives.

中文：0.7.8 已交付 rc.2；#150 是旧预览基线造成的重复审查。修正检测下限，历史专项保存为归档标签后撤掉活动分支；不把旧 beta 插件组合重新合入产品。alpha.2 独立桌面通道保持不变。
