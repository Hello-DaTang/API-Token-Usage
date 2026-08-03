import * as vscode from "vscode";

const SECRET_KEY = "apiTokenUsage.apiKey";
const CONFIG_SECTION = "apiTokenUsage";

interface UsageSnapshot {
  planName: string;
  remaining: number;
  used: number;
  total: number;
  unlimited: boolean;
  updatedAt: Date;
}

interface UsageSettings {
  label: string;
  baseUrl: string;
  usagePath: string;
  authorizationScheme: string;
  refreshMinutes: number;
  quotaPerDollar: number;
  currencySymbol: string;
  decimalPlaces: number;
  timeoutSeconds: number;
}

interface ActionQuickPickItem extends vscode.QuickPickItem {
  action: "refresh" | "copy" | "set-key" | "settings" | "clear-key";
}

type JsonRecord = Record<string, unknown>;

class UsageController implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly output: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];

  private refreshTimer: NodeJS.Timeout | undefined;
  private activeRefresh: Promise<void> | undefined;
  private snapshot: UsageSnapshot | undefined;
  private lastError: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      "apiTokenUsage.status",
      vscode.StatusBarAlignment.Left,
      20
    );
    this.statusBarItem.name = "API Token Usage";
    this.statusBarItem.command = "apiTokenUsage.showDetails";

    this.output = vscode.window.createOutputChannel("API Token Usage");

    this.disposables.push(
      vscode.commands.registerCommand("apiTokenUsage.setApiKey", () => this.setApiKey()),
      vscode.commands.registerCommand("apiTokenUsage.refresh", () => this.refresh(true)),
      vscode.commands.registerCommand("apiTokenUsage.showDetails", () => this.showDetails()),
      vscode.commands.registerCommand("apiTokenUsage.clearApiKey", () => this.clearApiKey()),
      vscode.commands.registerCommand("apiTokenUsage.openSettings", () => this.openSettings()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CONFIG_SECTION)) {
          this.configureRefreshTimer();
          void this.refresh(false);
        }
      })
    );
  }

  async start(): Promise<void> {
    this.statusBarItem.show();
    this.configureRefreshTimer();
    await this.refresh(false);
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.statusBarItem.dispose();
    this.output.dispose();
  }

  private async setApiKey(): Promise<void> {
    const existingApiKey = await this.context.secrets.get(SECRET_KEY);
    const apiKey = await vscode.window.showInputBox({
      title: existingApiKey ? "更新 API Key" : "设置 API Key",
      prompt: "API Key 将安全保存到 VS Code SecretStorage",
      placeHolder: "请输入用于查询额度的 API Key",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : "API Key 不能为空"
    });

    if (apiKey === undefined) {
      return;
    }

    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      void vscode.window.showWarningMessage("API Key 不能为空。");
      return;
    }

    await this.context.secrets.store(SECRET_KEY, normalizedApiKey);
    this.output.appendLine(`[${new Date().toISOString()}] API Key 已更新。`);
    void vscode.window.showInformationMessage("API Token Usage：API Key 已保存。");
    await this.refresh(true);
  }

  private async clearApiKey(): Promise<void> {
    const selected = await vscode.window.showWarningMessage(
      "确定清除 API Token Usage 保存的 API Key 吗？",
      { modal: true },
      "清除"
    );

    if (selected !== "清除") {
      return;
    }

    await this.context.secrets.delete(SECRET_KEY);
    this.snapshot = undefined;
    this.lastError = undefined;
    this.renderMissingKey();
    this.output.appendLine(`[${new Date().toISOString()}] API Key 已清除。`);
  }

  private async showDetails(): Promise<void> {
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      await this.setApiKey();
      return;
    }

    if (!this.snapshot) {
      await this.refresh(true);
    }

    const settings = this.getSettings();
    const detail = this.snapshot
      ? this.formatSnapshot(this.snapshot, settings, 4)
      : `当前没有可用数据${this.lastError ? `：${this.lastError}` : ""}`;

    const items: ActionQuickPickItem[] = [
      {
        label: "$(sync) 立即刷新",
        description: "重新请求最新额度",
        detail,
        action: "refresh"
      },
      {
        label: "$(copy) 复制用量摘要",
        description: "复制当前额度信息",
        action: "copy"
      },
      {
        label: "$(key) 设置 API Key",
        description: "更新查询接口使用的 Token",
        action: "set-key"
      },
      {
        label: "$(settings-gear) 打开设置",
        description: "修改地址、刷新间隔和换算比例",
        action: "settings"
      },
      {
        label: "$(trash) 清除 API Key",
        description: "从 SecretStorage 删除 Token",
        action: "clear-key"
      }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: `${this.safeLabel(settings.label)} 用量详情`,
      placeHolder: detail,
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (!selected) {
      return;
    }

    switch (selected.action) {
      case "refresh":
        await this.refresh(true);
        break;
      case "copy":
        await this.copySnapshot();
        break;
      case "set-key":
        await this.setApiKey();
        break;
      case "settings":
        await this.openSettings();
        break;
      case "clear-key":
        await this.clearApiKey();
        break;
    }
  }

  private async copySnapshot(): Promise<void> {
    if (!this.snapshot) {
      void vscode.window.showWarningMessage("当前没有可复制的用量数据。");
      return;
    }

    const text = this.formatSnapshot(this.snapshot, this.getSettings(), 4);
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage("API Token 用量摘要已复制。")
  }

  private async openSettings(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "@ext:hello-datang.api-token-usage"
    );
  }

  private configureRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    const refreshMinutes = this.getSettings().refreshMinutes;
    this.refreshTimer = setInterval(() => {
      void this.refresh(false);
    }, refreshMinutes * 60_000);
  }

  private refresh(showError: boolean): Promise<void> {
    if (this.activeRefresh) {
      return this.activeRefresh;
    }

    this.activeRefresh = this.performRefresh(showError).finally(() => {
      this.activeRefresh = undefined;
    });

    return this.activeRefresh;
  }

  private async performRefresh(showError: boolean): Promise<void> {
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      this.snapshot = undefined;
      this.lastError = undefined;
      this.renderMissingKey();
      return;
    }

    const settings = this.getSettings();
    this.renderRefreshing(settings.label);

    try {
      const snapshot = await this.fetchUsage(apiKey, settings);
      this.snapshot = snapshot;
      this.lastError = undefined;
      this.renderSnapshot(snapshot, settings);
      this.output.appendLine(
        `[${new Date().toISOString()}] 用量刷新成功：remaining=${snapshot.remaining}, used=${snapshot.used}, total=${snapshot.total}, unlimited=${snapshot.unlimited}`
      );
    } catch (error) {
      const message = this.toErrorMessage(error);
      this.lastError = message;
      this.renderError(settings.label, message);
      this.output.appendLine(`[${new Date().toISOString()}] 用量刷新失败：${message}`);

      if (showError) {
        const action = await vscode.window.showErrorMessage(
          `API Token Usage 查询失败：${message}`,
          "打开输出",
          "打开设置"
        );

        if (action === "打开输出") {
          this.output.show(true);
        } else if (action === "打开设置") {
          await this.openSettings();
        }
      }
    }
  }

  private async fetchUsage(apiKey: string, settings: UsageSettings): Promise<UsageSnapshot> {
    const endpoint = this.resolveEndpoint(settings.baseUrl, settings.usagePath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);

    try {
      const authorization = settings.authorizationScheme
        ? `${settings.authorizationScheme} ${apiKey}`
        : apiKey;

      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: authorization,
          Accept: "application/json"
        },
        signal: controller.signal
      });

      const rawText = await response.text();
      if (!rawText.trim()) {
        throw new Error(`服务器未返回数据，HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error(`服务器返回的不是有效 JSON，HTTP ${response.status}`);
      }

      if (!this.isRecord(payload)) {
        throw new Error("服务器返回结果不是 JSON 对象");
      }

      const serverMessage = this.readString(payload, "message");
      if (!response.ok) {
        throw new Error(serverMessage || `服务器返回 HTTP ${response.status}`);
      }

      if (payload.success === false || payload.code === false) {
        throw new Error(serverMessage || "用量查询失败");
      }

      const data = this.isRecord(payload.data) ? payload.data : payload;
      const totalAvailable = this.readNumber(data, "total_available");
      if (totalAvailable === undefined) {
        throw new Error("返回结果中不存在数值型 total_available");
      }

      const totalUsed = this.readNumber(data, "total_used") ?? 0;
      const totalGranted = this.readNumber(data, "total_granted") ?? 0;
      const planName = this.readString(data, "name") || "API Token";
      const unlimited = data.unlimited_quota === true;

      return {
        planName,
        remaining: totalAvailable / settings.quotaPerDollar,
        used: totalUsed / settings.quotaPerDollar,
        total: totalGranted / settings.quotaPerDollar,
        unlimited,
        updatedAt: new Date()
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`请求超过 ${settings.timeoutSeconds} 秒，已取消`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private renderMissingKey(): void {
    const label = this.safeLabel(this.getSettings().label);
    this.statusBarItem.text = `$(key) ${label} 未配置`;
    this.statusBarItem.tooltip = "点击设置 API Key";
    this.statusBarItem.command = "apiTokenUsage.setApiKey";
    this.statusBarItem.show();
  }

  private renderRefreshing(label: string): void {
    this.statusBarItem.text = `$(sync~spin) ${this.safeLabel(label)}`;
    this.statusBarItem.tooltip = "正在查询 API Token 用量...";
    this.statusBarItem.command = "apiTokenUsage.showDetails";
    this.statusBarItem.show();
  }

  private renderError(label: string, message: string): void {
    this.statusBarItem.text = `$(warning) ${this.safeLabel(label)}`;
    this.statusBarItem.tooltip = `额度查询失败：${message}\n\n点击查看详情或重新配置。`;
    this.statusBarItem.command = "apiTokenUsage.showDetails";
    this.statusBarItem.show();
  }

  private renderSnapshot(snapshot: UsageSnapshot, settings: UsageSettings): void {
    const label = this.safeLabel(settings.label);
    if (snapshot.unlimited) {
      this.statusBarItem.text = `$(infinity) ${label} 无限额度`;
    } else {
      this.statusBarItem.text = `$(credit-card) ${label} ${settings.currencySymbol}${snapshot.remaining.toFixed(settings.decimalPlaces)}`;
    }

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${this.escapeMarkdown(label)} 用量**\n\n`);
    tooltip.appendMarkdown(`${this.formatSnapshot(snapshot, settings, 4).replaceAll("\n", "  \n")}\n\n`);
    tooltip.appendMarkdown("点击打开详情菜单。\n");

    this.statusBarItem.tooltip = tooltip;
    this.statusBarItem.command = "apiTokenUsage.showDetails";
    this.statusBarItem.show();
  }

  private formatSnapshot(snapshot: UsageSnapshot, settings: UsageSettings, decimals: number): string {
    const remainingText = snapshot.unlimited
      ? "无限额度"
      : `${settings.currencySymbol}${snapshot.remaining.toFixed(decimals)}`;

    const lines = [
      `计划：${snapshot.planName}`,
      `剩余：${remainingText}`,
      `已使用：${settings.currencySymbol}${snapshot.used.toFixed(decimals)}`,
      `总额度：${settings.currencySymbol}${snapshot.total.toFixed(decimals)}`
    ];

    if (!snapshot.unlimited && snapshot.total > 0) {
      const percent = Math.max(0, Math.min(100, (snapshot.remaining / snapshot.total) * 100));
      lines.push(`剩余比例：${percent.toFixed(1)}%`);
    }

    lines.push(`更新时间：${snapshot.updatedAt.toLocaleString()}`);
    return lines.join("\n");
  }

  private getSettings(): UsageSettings {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    return {
      label: config.get<string>("label", "CTAPI").trim() || "CTAPI",
      baseUrl: config.get<string>("baseUrl", "https://ctapi.csxdtx.com:16000").trim(),
      usagePath: config.get<string>("usagePath", "/api/usage/token").trim(),
      authorizationScheme: config.get<string>("authorizationScheme", "Bearer").trim(),
      refreshMinutes: this.clamp(config.get<number>("refreshMinutes", 5), 1, 1440),
      quotaPerDollar: this.clamp(config.get<number>("quotaPerDollar", 500000), 1, Number.MAX_SAFE_INTEGER),
      currencySymbol: config.get<string>("currencySymbol", "$"),
      decimalPlaces: Math.trunc(this.clamp(config.get<number>("decimalPlaces", 2), 0, 8)),
      timeoutSeconds: this.clamp(config.get<number>("timeoutSeconds", 15), 1, 300)
    };
  }

  private resolveEndpoint(baseUrl: string, usagePath: string): string {
    if (/^https?:\/\//i.test(usagePath)) {
      return new URL(usagePath).toString();
    }

    if (!baseUrl) {
      throw new Error("apiTokenUsage.baseUrl 不能为空");
    }

    const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, "")}/`;
    const normalizedPath = usagePath.replace(/^\/+/, "");
    return new URL(normalizedPath, normalizedBaseUrl).toString();
  }

  private readNumber(record: JsonRecord, key: string): number | undefined {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private readString(record: JsonRecord, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, value));
  }

  private safeLabel(value: string): string {
    return value.replace(/[\r\n\t]/g, " ").replace(/\$\([^)]*\)/g, "").trim().slice(0, 40) || "API";
  }

  private escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, "\\$&");
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new UsageController(context);
  context.subscriptions.push(controller);
  await controller.start();
}

export function deactivate(): void {
  // UsageController 会由 VS Code 自动释放。
}
