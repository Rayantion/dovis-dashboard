import type {
  DashboardWidget,
  Profile,
  Todo,
  TodoPayload,
} from "@/lib/types";

/*
  Fixtures for demo mode. This is what the public showcase deployment renders.

  The content is written to show the product honestly: a queue of things Dovis
  PROPOSES, in a spread of states, including one failure. A demo where everything
  succeeds hides the part of the design that matters most.
*/

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

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
    },
    payload_current: {
      from: "dorm.office@example.edu.tw",
      task: "Reply with whether you are attending, and name a stand-in if you are not. They cannot book the room until the count is in.",
      event: "Dormitory committee — start-of-term meeting",
      subject: "【宿舍】期初委員會議出席確認",
      deadline: "2026-09-11",
      email_id: "18f2c9a4b7e01d33",
      location: "Building B, meeting room 2 (2F)",
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
    },
    payload_current: {
      from: "supplies@example.com",
      task: "Confirm the headcount and approve the total. The quote expires at the end of the week and the price holds only at 40 units or more.",
      subject: "Q4 stationery — quote for approval",
      received_at: "2026-09-05T08:14:00+08:00",
      cc_count: 4,
    },
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
    config: { kind: "metric", value: "7", caption: "of 31 handled since 06:00" },
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
