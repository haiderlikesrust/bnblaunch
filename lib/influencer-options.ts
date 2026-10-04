import { z } from "zod";

// Character options for the optional AI influencer. Each option is
// [id, English label, Chinese label, image-prompt phrase]. IDs are stored;
// only fixed phrases from this table ever reach the image model.
type Option = readonly [string, string, string, string];
type Group = { readonly label: readonly [string, string]; readonly multi: boolean; readonly options: readonly Option[] };
export const INFLUENCER_GROUPS = {
  kind: { label: ["角色", "Character"], multi: false, options: [
    ["human", "Human", "人类", "an original human character"],
    ["animal", "Animal", "动物", "an original anthropomorphic animal character"],
    ["robot", "Robot", "机器人", "an original robot character"],
    ["creature", "Creature", "奇幻生物", "an original fantasy creature character"],
    ["mascot", "Mascot", "吉祥物", "an original mascot character"],
    ["alien", "Alien", "外星人", "an original alien character"],
    ["elf", "Elf", "精灵", "an original elf character"],
    ["cyborg", "Cyborg", "赛博格", "an original cyborg character"],
  ] },
  presents: { label: ["外在呈现", "Presents as"], multi: false, options: [
    ["female", "Female", "女性", "with a feminine presentation"],
    ["male", "Male", "男性", "with a masculine presentation"],
    ["androgynous", "Androgynous", "中性", "with an androgynous presentation"],
    ["none", "None", "无", "with no gender presentation"],
  ] },
  age: { label: ["年龄", "Age"], multi: false, options: [
    ["young", "Young adult", "青年", "a young adult in their mid-twenties"],
    ["adult", "Adult", "成年", "an adult in their thirties"],
    ["older", "Older", "年长", "an older adult with silver accents"],
    ["ageless", "Ageless", "无龄", "ageless and timeless"],
  ] },
  build: { label: ["体型", "Build"], multi: false, options: [
    ["slim", "Slim", "纤细", "slim build"],
    ["athletic", "Athletic", "健美", "athletic build"],
    ["average", "Average", "匀称", "average build"],
    ["chubby", "Chubby", "圆润", "chubby, rounded build"],
    ["muscular", "Muscular", "强壮", "muscular build"],
    ["tiny", "Tiny", "迷你", "tiny, compact proportions"],
    ["huge", "Huge", "巨大", "huge, towering proportions"],
  ] },
  hair: { label: ["发型", "Hair"], multi: false, options: [
    ["short", "Short", "短发", "short hair"],
    ["long", "Long", "长发", "long hair"],
    ["curly", "Curly", "卷发", "curly hair"],
    ["braids", "Braids", "辫子", "braided hair"],
    ["buzz", "Buzz cut", "寸头", "a buzz cut"],
    ["messy", "Messy", "凌乱", "messy hair"],
    ["bald", "Bald", "光头", "a bald head"],
    ["neon", "Neon", "霓虹", "bright neon-coloured hair"],
    ["fur", "Fur / none", "毛发 / 无", "fur or no hair"],
  ] },
  outfit: { label: ["服装", "Outfit"], multi: false, options: [
    ["streetwear", "Streetwear", "街头", "streetwear"],
    ["hoodie", "Hoodie", "连帽衫", "an oversized hoodie"],
    ["suit", "Suit", "西装", "a tailored suit"],
    ["techwear", "Techwear", "机能风", "techwear"],
    ["y2k", "Y2K", "Y2K", "Y2K fashion"],
    ["sporty", "Sporty", "运动", "sporty athletic wear"],
    ["luxury", "Luxury", "奢华", "luxury designer clothing"],
    ["pyjamas", "Pyjamas", "睡衣", "cosy pyjamas"],
    ["armor", "Armor", "盔甲", "stylised armor"],
    ["cosplay", "Cosplay", "角色扮演", "an original cosplay costume"],
  ] },
  features: { label: ["特征", "Features"], multi: true, options: [
    ["freckles", "Freckles", "雀斑", "freckles"],
    ["tattoos", "Tattoos", "纹身", "tattoos"],
    ["scars", "Scars", "伤疤", "a small scar"],
    ["glowing", "Glowing eyes", "发光眼睛", "glowing eyes"],
    ["heterochromia", "Heterochromia", "异色瞳", "heterochromia"],
    ["horns", "Horns", "角", "horns"],
    ["ears", "Ears", "兽耳", "animal ears"],
    ["tail", "Tail", "尾巴", "a tail"],
    ["wings", "Wings", "翅膀", "wings"],
    ["piercings", "Piercings", "穿孔", "piercings"],
  ] },
  accessories: { label: ["配饰", "Accessories"], multi: true, options: [
    ["sunglasses", "Sunglasses", "墨镜", "sunglasses"],
    ["glasses", "Glasses", "眼镜", "glasses"],
    ["cap", "Cap", "棒球帽", "a cap"],
    ["headphones", "Headphones", "耳机", "headphones"],
    ["chains", "Chains", "项链", "chains"],
    ["mask", "Mask", "面具", "a mask"],
    ["crown", "Crown", "王冠", "a crown"],
    ["backpack", "Backpack", "背包", "a backpack"],
    ["phone", "Phone", "手机", "a phone in hand"],
    ["laser", "Laser eyes", "激光眼", "laser eyes"],
  ] },
  vibe: { label: ["镜头气质", "Vibe on camera"], multi: false, options: [
    ["deadpan", "Deadpan", "冷面", "deadpan"],
    ["hyped", "Hyped", "亢奋", "hyped and energetic"],
    ["chill", "Chill", "松弛", "chill and relaxed"],
    ["chaotic", "Chaotic", "混乱", "chaotic and unpredictable"],
    ["wholesome", "Wholesome", "治愈", "wholesome and warm"],
    ["mysterious", "Mysterious", "神秘", "mysterious"],
    ["smug", "Smug", "得意", "smug and playful"],
    ["nerdy", "Nerdy", "极客", "nerdy and curious"],
  ] },
  style: { label: ["视觉风格", "Visual style"], multi: false, options: [
    ["logo", "Match the logo", "匹配标志", "a style and colour palette matched to the coin logo"],
    ["3d", "3D animated", "3D 动画", "polished 3D animated film style"],
    ["photoreal", "Photoreal", "写实", "photorealistic style"],
    ["anime", "Anime", "动漫", "anime style"],
    ["clay", "Claymation", "黏土动画", "claymation style"],
    ["pixel", "Pixel art", "像素", "pixel art style"],
    ["comic", "Comic ink", "漫画墨线", "comic ink style"],
    ["cyberpunk", "Cyberpunk", "赛博朋克", "cyberpunk style"],
    ["vaporwave", "Vaporwave", "蒸汽波", "vaporwave style"],
    ["toy", "Toy figure", "玩具手办", "collectible toy figure style"],
  ] },
} as const satisfies Record<string, Group>;
export type InfluencerGroup = keyof typeof INFLUENCER_GROUPS;
type Ids<G extends InfluencerGroup> = (typeof INFLUENCER_GROUPS)[G]["options"][number][0];
const ids = <G extends InfluencerGroup>(group: G) => INFLUENCER_GROUPS[group].options.map(o => o[0]) as [Ids<G>, ...Ids<G>[]];
const single = <G extends InfluencerGroup>(group: G) => z.enum(ids(group)).nullable().default(null);
const many = <G extends InfluencerGroup>(group: G) => z.array(z.enum(ids(group))).max(INFLUENCER_GROUPS[group].options.length).default([]).refine(v => new Set(v).size === v.length, "Duplicate option");

export const influencerInput = z.object({
  enabled: z.literal(true),
  kind: single("kind"), presents: single("presents"), age: single("age"), build: single("build"),
  hair: single("hair"), outfit: single("outfit"), features: many("features"), accessories: many("accessories"),
  vibe: single("vibe"), style: z.enum(ids("style")).default("logo"),
  // Dominant logo colours, sampled in the browser, steer "Match the logo".
  palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(4).default([]),
  notes: z.string().trim().max(600).default(""),
}).strict();
export type InfluencerConfig = z.infer<typeof influencerInput>;

export function optionLabel(group: InfluencerGroup, id: string | null | undefined, t: (zh: string, en: string) => string) {
  const option = (INFLUENCER_GROUPS[group].options as readonly Option[]).find(o => o[0] === id);
  return option ? t(option[2], option[1]) : "";
}
const phrase = (group: InfluencerGroup, id: string | null | undefined) => (INFLUENCER_GROUPS[group].options as readonly Option[]).find(o => o[0] === id)?.[3] ?? "";

// Approximate colour names; image models follow names better than hex codes.
const NAMED: [string, number, number, number][] = [["black", 20, 20, 20], ["charcoal", 60, 60, 64], ["grey", 128, 128, 128], ["silver", 192, 192, 196], ["white", 245, 245, 245], ["red", 220, 40, 40], ["crimson", 150, 20, 40], ["orange", 255, 130, 30], ["amber", 255, 190, 0], ["gold", 212, 175, 55], ["yellow", 250, 230, 60], ["lime", 160, 230, 50], ["green", 40, 160, 70], ["emerald", 20, 120, 90], ["teal", 20, 140, 140], ["cyan", 40, 210, 230], ["sky blue", 110, 180, 240], ["blue", 40, 80, 220], ["navy", 20, 30, 90], ["indigo", 75, 50, 160], ["purple", 130, 60, 190], ["violet", 170, 110, 230], ["magenta", 220, 40, 170], ["pink", 245, 150, 190], ["brown", 120, 75, 40], ["beige", 225, 205, 170], ["cream", 250, 240, 215]];
export function colourName(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  let best = NAMED[0], distance = Infinity;
  for (const named of NAMED) { const d = (named[1] - r) ** 2 + (named[2] - g) ** 2 + (named[3] - b) ** 2; if (d < distance) { distance = d; best = named; } }
  return best[0];
}

// The written brief: shown before launch and used for the character master.
export function influencerBrief(config: InfluencerConfig, coin: { name: string; symbol: string }) {
  const subject = [phrase("kind", config.kind) || "an original character", phrase("presents", config.presents)].filter(Boolean).join(" ");
  const traits = [phrase("age", config.age), phrase("build", config.build), phrase("hair", config.hair), config.outfit ? "wearing " + phrase("outfit", config.outfit) : ""].filter(Boolean);
  const extras = [...config.features.map(f => phrase("features", f)), ...config.accessories.map(a => phrase("accessories", a))];
  const colours = [...new Set(config.palette.map(colourName))];
  const style = config.style === "logo" ? (colours.length ? `a style and colour palette of ${colours.join(", ")}, matched to the ${coin.name} coin logo` : `a style matched to the ${coin.name} coin logo`) : phrase("style", config.style);
  return [
    `The face of ${coin.name} ($${coin.symbol}): ${subject}${traits.length ? ", " + traits.join(", ") : ""}${extras.length ? ", with " + extras.join(", ") : ""}.`,
    config.vibe ? `On camera: ${phrase("vibe", config.vibe)}.` : "",
    `Visual style: ${style}.`,
    "Always an adult, always fictional and AI-generated.",
  ].filter(Boolean).join(" ");
}
export function hasCharacterChoices(config: InfluencerConfig) {
  return !!(config.kind || config.presents || config.age || config.build || config.hair || config.outfit || config.vibe || config.features.length || config.accessories.length || config.notes || config.style !== "logo");
}
