# Code signing policy

DSH-Portable is applying to SignPath Foundation for open-source code signing. The application is in progress, and current release files are unsigned; the planned signing scope is the Windows executables. Until this page changes, download releases only from the project's [GitHub Releases](https://github.com/WSL043/DSH-Portable/releases) page.

## Release boundary

- Signing will cover the Windows executables produced by the repository's controlled GitHub Actions release workflow.
- A signing request may only use artifacts from the exact public commit and successful finished-product build selected for that release.
- Signing approval is separate from authoring source changes. The maintainer reviews release evidence before approving a request.
- Locally built or manually substituted binaries are never submitted as official release artifacts.
- Release checksums remain available independently of the signature.

## Team roles

- Authors and reviewers: [WSL043](https://github.com/WSL043), the repository maintainer. Contributions from people without commit access are reviewed before merge.
- Approver: [WSL043](https://github.com/WSL043), responsible for checking the source revision, finished-product test run, and artifact identity before every signing request.

The application follows the project's [privacy policy](PRIVACY.md). DSH-Portable does not operate a telemetry or analytics service; network access initiated by the user, DSH, a selected model provider, a plugin, or the update checker remains subject to that component's own policy.

After SignPath approval and workflow enrollment, this document will name the active certificate and verification identity. The workflow will use SignPath's GitHub integration; no private signing key will be stored in the repository.

On Windows, inspect a downloaded executable with:

```powershell
Get-AuthenticodeSignature .\DSH-Portable-windows-x64.exe | Format-List Status,SignerCertificate
```

`NotSigned` is the expected result for releases published while the application notice above remains in place.

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

---

## 中文说明

DSH-Portable 正在申请 SignPath Foundation 的开源代码签名。申请尚未完成，当前 Windows Release 文件仍未签名。在本页更新前，请只从项目的 [GitHub Releases](https://github.com/WSL043/DSH-Portable/releases) 页面下载。

### 发布边界

- 签名对象是仓库受控 GitHub Actions 发布流程生成的 Windows 可执行文件。
- 签名请求只能使用该 Release 对应公开提交及成品测试成功后产生的文件。
- 签名批准与源码编写分离；维护者确认发布证据后才批准签名请求。
- 本地构建或人工替换的二进制文件不会作为正式 Release 提交签名。
- Release 校验值会继续独立提供。

### 团队职责

- 作者与审查者：[WSL043](https://github.com/WSL043)，即仓库维护者。没有提交权限的贡献者所提交的改动会在合并前接受审查。
- 签名批准者：[WSL043](https://github.com/WSL043)，每次签名请求前负责核对源码版本、成品测试和文件身份。

应用遵循项目的[隐私策略](PRIVACY.md)。DSH-Portable 本身不运营遥测或分析服务；用户、DSH、所选模型服务商、插件或更新检查主动发起的联网行为仍受对应组件政策约束。

SignPath 审核通过并完成工作流接入后，本页会公布实际证书与验证身份。签名流程将使用 SignPath 的 GitHub 集成，仓库不会保存私钥。

Windows 用户可以这样检查下载文件：

```powershell
Get-AuthenticodeSignature .\DSH-Portable-windows-x64.exe | Format-List Status,SignerCertificate
```

在本页仍显示申请中时，结果为 `NotSigned` 属于当前预期状态。
