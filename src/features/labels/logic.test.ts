import { describe, expect, it } from "vitest";
import type { AssistLabel, AssistLabelLogEntry, LabelVerdict, ThreadSummary } from "@/backend/types";
import { LABEL_DEFAULTS } from "../assist/labels";
import {
  cleanRules,
  filterLabels,
  groupByLabel,
  initialTicks,
  labelPresence,
  labelReasonText,
  labelSearchTerm,
  listKeywords,
  NO_SUCH_LABEL,
  parseLabelSearch,
  ruleProblems,
  suggestionChanges,
} from "./logic";

const label = (id: string, name: string, keyword: string): AssistLabel => ({
  ...LABEL_DEFAULTS,
  id,
  name,
  keyword,
  description: "",
  color: null,
});

const LABELS = [
  label("g1", "Rechnungen", "rechnungen"),
  label("g2", "Orders & shipping", "orders-shipping"),
  label("g3", "Reisen", "reisen"),
];

const thread = (id: string, keywords?: string[]): ThreadSummary => ({
  id,
  accountIds: ["a1"],
  subject: id,
  participants: [],
  snippet: "",
  lastDate: "2026-09-30T10:00:00Z",
  messageCount: 1,
  unreadCount: 0,
  flagged: false,
  hasAttachments: false,
  hasDraft: false,
  ...(keywords ? { keywords } : {}),
});

describe("label: in the search", () => {
  it("finds labels by name (any case) or keyword and keeps the rest of the search", () => {
    expect(parseLabelSearch("label:rechnungen telekom", LABELS)).toEqual({
      text: "telekom",
      keywords: ["rechnungen"],
      unknown: [],
    });
    expect(parseLabelSearch('from anna label:"Orders & Shipping" label:reisen', LABELS)).toEqual({
      text: "from anna",
      keywords: ["orders-shipping", "reisen"],
      unknown: [],
    });
    expect(parseLabelSearch("label:orders-shipping", LABELS).keywords).toEqual(["orders-shipping"]);
  });

  it("takes single quotes, a quote left open and the same label twice", () => {
    expect(parseLabelSearch("label:'Reisen' label:REISEN", LABELS).keywords).toEqual(["reisen"]);
    expect(parseLabelSearch('label:"Orders & shipping', LABELS)).toEqual({
      text: "",
      keywords: ["orders-shipping"],
      unknown: [],
    });
  });

  it("leaves words that only contain label: alone and ignores an empty one", () => {
    expect(parseLabelSearch("mylabel:x label:", LABELS)).toEqual({ text: "mylabel:x", keywords: [], unknown: [] });
  });

  it("finds nothing for a name that is no label", () => {
    const search = parseLabelSearch("label:Urlaub", LABELS);
    expect(search.unknown).toEqual(["Urlaub"]);
    expect(listKeywords([], search)).toEqual([NO_SUCH_LABEL]);
  });

  it("joins the chips and the search without doubles", () => {
    expect(listKeywords(["reisen"], parseLabelSearch("label:reisen label:rechnungen", LABELS))).toEqual([
      "reisen",
      "rechnungen",
    ]);
  });

  it("writes a term that reads back as the same label", () => {
    for (const entry of LABELS) {
      expect(parseLabelSearch(labelSearchTerm(entry), LABELS).keywords).toEqual([entry.keyword]);
    }
  });
});

describe("sections per label", () => {
  it("puts each conversation once, under its first label in the person's order, the rest last", () => {
    const sections = groupByLabel(
      [thread("t1", ["reisen", "rechnungen"]), thread("t2"), thread("t3", ["reisen"]), thread("t4", ["other"])],
      LABELS,
    );
    expect(sections.map((section) => [section.label?.id ?? null, section.threads.map((t) => t.id)])).toEqual([
      ["g1", ["t1"]],
      ["g3", ["t3"]],
      [null, ["t2", "t4"]],
    ]);
  });

  it("keeps the list's order inside a section and leaves out empty ones", () => {
    const sections = groupByLabel([thread("b", ["reisen"]), thread("a", ["reisen"])], LABELS);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.threads.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("the quick picker", () => {
  it("tells whether all, some or none carry a label", () => {
    const items = [{ keywords: ["reisen"] }, { keywords: [] }, {}];
    expect(labelPresence(items, "reisen")).toBe("some");
    expect(labelPresence(items.slice(0, 1), "reisen")).toBe("all");
    expect(labelPresence(items, "rechnungen")).toBe("none");
    expect(labelPresence([], "reisen")).toBe("none");
  });

  it("lists names that start with the text first", () => {
    expect(filterLabels(LABELS, "re").map((l) => l.id)).toEqual(["g1", "g3"]);
    expect(filterLabels(LABELS, "ship").map((l) => l.id)).toEqual(["g2"]);
    expect(filterLabels(LABELS, "  ")).toHaveLength(3);
  });
});

describe("Label again", () => {
  const verdicts: LabelVerdict[] = [
    { labelId: "g1", fits: true, reason: "", isSet: false },
    { labelId: "g2", fits: false, reason: "", isSet: true },
    { labelId: "g3", fits: true, reason: "", isSet: true },
    { labelId: "gone", fits: true, reason: "", isSet: false },
  ];

  it("ticks what fits, set or not", () => {
    expect(initialTicks(verdicts)).toEqual({ g1: true, g2: false, g3: true, gone: true });
  });

  it("changes only what differs from the mail: adds, and takes off what no longer fits", () => {
    expect(suggestionChanges(verdicts, initialTicks(verdicts), LABELS)).toEqual({
      rechnungen: true,
      "orders-shipping": false,
    });
    // The person keeps a label the model would take off, and leaves one out it would add.
    expect(suggestionChanges(verdicts, { g1: false, g2: true, g3: true }, LABELS)).toEqual({});
  });
});

describe("a label's own conditions", () => {
  it("needs a value except for attachments", () => {
    expect(
      ruleProblems({
        match: "all",
        conditions: [
          { field: "from", value: " " },
          { field: "hasAttachment", value: "" },
          { field: "subject", value: "x".repeat(201) },
          { field: "text", value: "ok" },
        ],
      }),
    ).toEqual([0, 2]);
    expect(ruleProblems(null)).toEqual([]);
  });

  it("are kept trimmed, and none as null", () => {
    expect(
      cleanRules({
        match: "any",
        conditions: [
          { field: "from", value: " shop.example " },
          { field: "hasAttachment", value: "left over" },
          { field: "hasAttachment", value: "false" },
        ],
      }),
    ).toEqual({
      match: "any",
      conditions: [
        { field: "from", value: "shop.example" },
        { field: "hasAttachment", value: "true" },
        { field: "hasAttachment", value: "false" },
      ],
    });
    expect(cleanRules({ match: "all", conditions: [] })).toBeNull();
  });
});

describe("why a label is on", () => {
  const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ""}`;
  const why = (source: AssistLabelLogEntry["source"], code: string | null, params: Record<string, unknown> = {}) =>
    labelReasonText({ source, code, params, reason: "server words" }, t, "en");

  it("keeps the model's own words and the server's sentence for codes it doesn't know", () => {
    expect(why("ai", "ai")).toBe("server words");
    expect(why("detector", "horoscope", { sign: "leo" })).toBe("server words");
    expect(why("detector", null)).toBe("server words");
    expect(why("sender", "sender", {})).toBe("server words");
  });

  it("puts the codes in the person's words", () => {
    expect(
      why("rule", "rule", {
        match: "any",
        conditions: [
          { field: "from", value: "shop.example" },
          { field: "hasAttachment", value: "false" },
        ],
      }),
    ).toBe(
      'labels.reason.ruleAny{"conditions":"labels.reason.field.from{\\"value\\":\\"shop.example\\"}, labels.reason.field.attachmentNo"}',
    );
    expect(why("sender", "sender", { address: "leni@example.org", count: 3 })).toBe(
      'labels.reason.sender{"address":"leni@example.org","count":"3"}',
    );
    expect(why("detector", "invoice", { word: "Rechnung", amount: null })).toBe(
      'labels.reason.invoiceWord{"word":"Rechnung"}',
    );
    expect(why("detector", "appointment", { word: "Termin", date: "06.10.2026", time: "09:30" })).toBe(
      'labels.reason.appointmentWordDate{"word":"Termin","when":"06.10.2026 09:30"}',
    );
    expect(why("detector", "shipping", { carrier: null, tracking: null })).toBe("labels.reason.shipping");
    expect(why("classifier", "classifier", { probability: 0.994, examples: 23 })).toBe(
      'labels.reason.classifier{"percent":"99.4%","examples":"23"}',
    );
  });
});
