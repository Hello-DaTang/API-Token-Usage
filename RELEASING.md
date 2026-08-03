# 构建与发布

本仓库使用 GitHub Actions 自动编译并打包 VS Code 扩展。

## 持续构建版

每次向 `main` 分支推送代码时，Actions 会执行：

1. 安装 npm 依赖
2. TypeScript 类型检查
3. 打包 `.vsix`
4. 更新 `continuous` 预发布版本

可以在仓库的 **Releases** 页面下载：

```text
api-token-usage-latest.vsix
```

该文件始终对应 `main` 分支的最新构建，适合测试。

普通 CI 运行也会保留一个 VSIX Artifact：主分支和 PR 构建保留 14 天，发布工作流 Artifact 保留 30 天。

## 正式版本

正式版本号以 `package.json` 中的 `version` 为准。例如：

```json
{
  "version": "0.1.0"
}
```

发布正式版时创建并推送同版本标签：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

标签必须严格等于 `v` 加上 `package.json` 版本，否则 Actions 会终止发布。

成功后，Releases 页面会生成：

```text
api-token-usage-0.1.0.vsix
```

## 安装 VSIX

```powershell
code --install-extension .\api-token-usage-latest.vsix
```

或者在 VS Code 扩展面板右上角选择 **从 VSIX 安装...**。

## 手动运行

在 GitHub 仓库中打开：

```text
Actions → Release VSIX → Run workflow
```

手动运行默认构建 `main` 分支并更新持续构建版。
