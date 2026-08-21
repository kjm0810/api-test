export type DonationTier = { min: number; max: number | null; text: string; image: string };

export type DonationTypeFilter = {
  soopBalloon: boolean;
  soopVideo: boolean;
  soopAdballoon: boolean;
  chzzkChat: boolean;
  chzzkVideo: boolean;
  chzzkParty: boolean;
};

export type OverlaySettings = {
  theme: string;
  transparency: number;
  tooltipMenu: boolean;
  donationTypes: DonationTypeFilter;
  defaultText: string;
  tiers: DonationTier[];
  ttsEnabled: boolean;
};

export const OVERLAY_THEMES = [
  { id: "basic", name: "기본" },
  { id: "heart", name: "하트" },
  { id: "star", name: "스타" },
  { id: "neon", name: "네온" },
] as const;

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  theme: "basic",
  transparency: 100,
  tooltipMenu: true,
  donationTypes: {
    soopBalloon: true, soopVideo: true, soopAdballoon: true,
    chzzkChat: true, chzzkVideo: true, chzzkParty: true,
  },
  defaultText: "{닉네임}님 {개수}개 감사합니다!",
  tiers: [],
  ttsEnabled: false,
};

export function normalizeOverlaySettings(input: Partial<OverlaySettings> | undefined | null): OverlaySettings {
  return {
    ...DEFAULT_OVERLAY_SETTINGS,
    ...input,
    donationTypes: { ...DEFAULT_OVERLAY_SETTINGS.donationTypes, ...input?.donationTypes },
    tiers: input?.tiers ?? [],
  };
}

export function pickTier(settings: OverlaySettings, cnt: number): DonationTier | null {
  return settings.tiers.find((tier) => cnt >= tier.min && (tier.max == null || cnt <= tier.max)) ?? null;
}

export function renderTemplate(template: string, vars: { nickname: string; cnt: number; amount: number; message: string }) {
  return template
    .replaceAll("{닉네임}", vars.nickname)
    .replaceAll("{개수}", String(vars.cnt))
    .replaceAll("{금액}", vars.amount.toLocaleString())
    .replaceAll("{메시지}", vars.message);
}

export function donationTypeKey(event: { platform: string; extras?: unknown }): keyof DonationTypeFilter | null {
  const extras = (event.extras ?? {}) as Record<string, unknown>;
  if (event.platform === "soop") {
    const typeName = extras.typeName;
    if (typeName === "SVC_SENDBALLOON") return "soopBalloon";
    if (typeName === "SVC_VIDEOBALLOON") return "soopVideo";
    if (typeName === "SVC_ADCON_EFFECT") return "soopAdballoon";
    return null;
  }
  if (event.platform === "chzzk") {
    const chzzk = (extras.chzzk ?? {}) as Record<string, unknown>;
    const donationType = chzzk.donationType;
    if (donationType === "CHAT") return "chzzkChat";
    if (donationType === "VIDEO") return "chzzkVideo";
    if (donationType === "PARTY") return "chzzkParty";
    return null;
  }
  return null;
}

export function isDonationTypeEnabled(settings: OverlaySettings, event: { platform: string; extras?: unknown }): boolean {
  const key = donationTypeKey(event);
  if (!key) return true;
  return settings.donationTypes[key];
}

export type WidgetType = "donation" | "chat" | "game";

export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  donation: "후원 알림", chat: "채팅", game: "게임",
};

export type ChatSettings = { theme: string; maxMessages: number };

export const DEFAULT_CHAT_SETTINGS: ChatSettings = { theme: "basic", maxMessages: 30 };

export function normalizeChatSettings(input: Partial<ChatSettings> | undefined | null): ChatSettings {
  return { ...DEFAULT_CHAT_SETTINGS, ...input };
}

export type GameSettings = { gameType: "roulette"; triggerMinCnt: number };

export const DEFAULT_GAME_SETTINGS: GameSettings = { gameType: "roulette", triggerMinCnt: 1 };

export function normalizeGameSettings(input: Partial<GameSettings> | undefined | null): GameSettings {
  return { ...DEFAULT_GAME_SETTINGS, ...input };
}
