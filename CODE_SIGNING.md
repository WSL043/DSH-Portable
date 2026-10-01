# Code signing policy

DSH-Portable's Windows files are **not digitally signed**: current release files are unsigned. The application to SignPath Foundation for open-source code signing was not approved, and this project is free, volunteer-maintained work, so it does not buy a certificate. If sponsorship or a free signing program that fits the project becomes available, this page will name the certificate and verification identity before any signed file is published.

Because the files are unsigned, Windows SmartScreen or Microsoft Defender may warn about or even remove a freshly published file. See "Windows Security removed the program or blocked it" in the [user guide](docs/user-guide.en.md#windows-security-removed-the-program-or-blocked-it).

## How to trust a download

- Download only from the project's [GitHub Releases](https://github.com/WSL043/DSH-Portable/releases) page.
- Release files are produced by the repository's GitHub Actions release workflow from a public commit after the finished-product tests pass. Locally built or manually substituted binaries are never published as official release artifacts.
- Compare the SHA-256 values in `checksums.txt` with the file you downloaded (`Get-FileHash .\file.zip -Algorithm SHA256`).

- Authors and reviewers: [WSL043](https://github.com/WSL043), the repository maintainer. Contributions from people without commit access are reviewed before merge.
- Approver: [WSL043](https://github.com/WSL043), responsible for checking the source revision, finished-product test run, and artifact identity before every release.

The application follows the project's [privacy policy](PRIVACY.md). DSH-Portable does not operate a telemetry or analytics service; network access initiated by the user, DSH, a selected model provider, a plugin, or the update checker remains subject to that component's own policy.

On Windows, inspect a downloaded executable with:

```powershell
Get-AuthenticodeSignature .\DSH-Portable-windows-x64.exe | Format-List Status,SignerCertificate
```

`NotSigned` is the expected result for current releases.

---

## 中文说明

DSH-Portable 的 Windows 文件**没有数字签名**。向 SignPath Foundation 申请的开源代码签名未获通过；本项目是免费、无偿的志愿维护，因此不购买证书。如果以后出现赞助或适合本项目的免费签名计划，会先在本页公布证书与验证身份，再发布签名文件。

由于文件未签名，Windows SmartScreen 或 Microsoft Defender 可能对刚发布的文件发出警告，甚至直接删除。处理方法见[用户指南](docs/user-guide.zh-CN.md#windows-安全中心删除了程序或拦截启动)中的“Windows 安全中心删除了程序或拦截启动”。

### 如何确认下载可信

- 只从项目的 [GitHub Releases](https://github.com/WSL043/DSH-Portable/releases) 页面下载。
- Release 文件由仓库的 GitHub Actions 发布流程，在成品测试通过后，从公开提交构建；本地构建或人工替换的二进制文件不会作为正式 Release 发布。
- 把 `checksums.txt` 中的 SHA-256 与下载的文件比对（`Get-FileHash .\文件.zip -Algorithm SHA256`）。

- 作者与审查者：[WSL043](https://github.com/WSL043)，即仓库维护者。没有提交权限的贡献者所提交的改动会在合并前接受审查。
- 发布批准者：[WSL043](https://github.com/WSL043)，每次发布前负责核对源码版本、成品测试和文件身份。

应用遵循项目的[隐私策略](PRIVACY.md)。DSH-Portable 本身不运营遥测或分析服务；用户、DSH、所选模型服务商、插件或更新检查主动发起的联网行为仍受对应组件政策约束。

Windows 用户可以这样检查下载文件：

```powershell
Get-AuthenticodeSignature .\DSH-Portable-windows-x64.exe | Format-List Status,SignerCertificate
```

当前版本的结果为 `NotSigned`，属于预期状态。
