export const MANAGED_TAG = "obsidian_anki_sync";
export const UUID_TAG_PREFIX = "obsidian_uuid_";
export const PATH_TAG_PREFIX = "obsidian_path_";

export const DEFAULT_ANKI_CONNECT_URL = "http://127.0.0.1:8765";
export const DEFAULT_ROOT_DECK = "Obsidian";

export const TEMPLATE_SETUP_HINT =
	"Missing Modern Anki note types. Create them with the my_anki_template setup script (anki_connect.py).";

export const SUPPORTED_MODELS = [
	"Cloze-Modern",
	"Cloze-Modern-Typing",
	"Basic-Modern",
	"Basic-Modern-Reversed",
	"Basic-Modern-Typing",
] as const;

export type SupportedModelName = (typeof SUPPORTED_MODELS)[number];

export const MODEL_ALIASES: Record<string, SupportedModelName> = {
	cloze: "Cloze-Modern",
	"cloze-modern": "Cloze-Modern",
	"cloze-type": "Cloze-Modern-Typing",
	"cloze-typing": "Cloze-Modern-Typing",
	"cloze-modern-typing": "Cloze-Modern-Typing",
	basic: "Basic-Modern",
	"basic-modern": "Basic-Modern",
	"basic-reversed": "Basic-Modern-Reversed",
	reversed: "Basic-Modern-Reversed",
	"basic-modern-reversed": "Basic-Modern-Reversed",
	"basic-type": "Basic-Modern-Typing",
	"basic-typing": "Basic-Modern-Typing",
	"basic-modern-typing": "Basic-Modern-Typing",
};
