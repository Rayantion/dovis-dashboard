"use client";

import { createContext, useContext } from "react";

/*
  Bilingual EN / zh-TW, per SOUL.md: "Bilingual English and Traditional Chinese.
  For Chinese use Taiwan vocabulary — 軟體 not 軟件, 資料 not 数据, 快取 not 緩存,
  程式 not 程序."

  This is a plain dictionary rather than i18next on purpose: the surface is small,
  and a 40KB runtime for two languages would be the largest thing on the page.
*/

export type Lang = "en" | "zh-TW";

export const dict = {
  en: {
    brand: "Dovis",
    tagline: "Proposals waiting on your decision.",
    waitingHeadline: "{n} things need you",
    waitingHeadlineOne: "One thing needs you",
    allClear: "Nothing needs you right now",
    briefing: "Briefing",
    queue: "Action queue",
    queueEmpty: "Nothing waiting. Dovis will surface the next thing itself.",
    team: "Team",
    dangerZone: "Danger zone",
    signIn: "Sign in",
    signOut: "Sign out",
    usernameOrEmail: "Username or email",
    password: "Password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    setPassword: "Set password",
    tempPasswordNotice:
      "This account is using a temporary password. Choose a new one to continue.",
    confirm: "Confirm",
    modify: "Modify",
    reject: "Reject",
    readOnly: "Read-only",
    readOnlyHint: "Your account can view the queue but not act on it.",
    whatWouldBeSent: "What would be sent",
    whatChanged: "What changed",
    originalProposal: "Original proposal",
    modifyPrompt: "What should change?",
    rejectPrompt: "Why not? Dovis learns more from this than from a confirmation.",
    send: "Send to Dovis",
    cancel: "Cancel",
    status: {
      proposed: "Waiting on you",
      modifying: "Dovis is redoing it",
      confirmed: "Confirmed",
      executing: "Working",
      done: "Done",
      rejected: "Rejected",
      failed: "Failed",
    },
    action: { draft_email: "Email draft", manual: "For you to do" },
    addAdmin: "Add assistant",
    email: "Email",
    username: "Username",
    displayName: "Name",
    role: "Role",
    accountStatus: "Status",
    allowModify: "Allow modify",
    active: "Active",
    paused: "Paused",
    pause: "Pause",
    resume: "Resume",
    remove: "Remove",
    owner: "Owner",
    admin: "Assistant",
    tempPasswordIs: "Temporary password",
    tempPasswordCopy:
      "Give this to them directly. They will be forced to change it on first sign-in.",
    allowModifyWarningTitle: "Let this assistant act on your behalf?",
    allowModifyWarningBody:
      "With this on, they can confirm, modify and reject items in your queue. Confirming an email item writes a finished draft into YOUR Gmail under your name. They still cannot delete anything, and they still cannot send — you press send. Turn this on only for someone you would let read your inbox.",
    enableAnyway: "Yes, allow it",
    removeAdminTitle: "Remove this account?",
    removeAdminBody:
      "They lose access immediately. This cannot be undone — you would have to create the account again.",
    dangerZoneHint:
      "Everything here is irreversible and owner-only. Your assistant cannot see or reach any of it.",
    googleTitle: "Google account",
    googleNotConnected:
      "Not connected. Dovis cannot read your mail or calendar until this is done.",
    googleConnect: "Connect Google",
    googleReconnect: "Reconnect",
    googleConnected: "Connected",
    googleUnavailable:
      "Google sign-in is not configured on this deployment. It runs only on a real Dovis box, never on the demo.",
    clearCta: "Clear",
    deleteCta: "Delete",
    clearCompleted: "Clear completed items",
    clearCompletedHint:
      "Deletes every done and rejected item, and the drafts recorded against them. Dovis loses that history and stops learning from it.",
    deleteAll: "Delete the entire queue",
    deleteAllHint:
      "Removes every item in every state, including things still waiting on you.",
    typeToConfirm: "Type",
    toConfirm: "to confirm",
    demoBanner:
      "Demo data. Nothing here is real and nothing is saved — reload to reset.",
    language: "Language",
    theme: "Theme",
    refresh: "Refresh",
    refreshing: "Refreshing",
    newItems: "{n} queue changes waiting",
    newItemsOne: "One queue change waiting",
    showThem: "Show them",
    connectionStale: "Reconnecting — this may be out of date",
    connectionOffline: "Not live — this may be out of date",
    refreshDemo: "Demo data never changes on its own.",
    payloadFailed: "Could not load the contents.",
    draftsRestricted:
      "Your account can see the queue but not the draft bodies.",
  },
  "zh-TW": {
    brand: "Dovis",
    tagline: "等你決定的提案。",
    waitingHeadline: "{n} 項等你決定",
    waitingHeadlineOne: "一項等你決定",
    allClear: "目前沒有需要你決定的事",
    briefing: "簡報",
    queue: "行動佇列",
    queueEmpty: "目前沒有待辦。有事情 Dovis 會自己提出來。",
    team: "團隊",
    dangerZone: "危險操作",
    signIn: "登入",
    signOut: "登出",
    usernameOrEmail: "使用者名稱或電子郵件",
    password: "密碼",
    newPassword: "新密碼",
    confirmPassword: "確認新密碼",
    setPassword: "設定密碼",
    tempPasswordNotice: "這個帳號目前使用臨時密碼，請先設定新密碼才能繼續。",
    confirm: "確認",
    modify: "修改",
    reject: "退回",
    readOnly: "唯讀",
    readOnlyHint: "你的帳號可以檢視佇列，但不能執行操作。",
    whatWouldBeSent: "將寄出的內容",
    whatChanged: "修改了什麼",
    originalProposal: "原始提案",
    modifyPrompt: "需要改哪裡？",
    rejectPrompt: "為什麼不行？退回比確認更能讓 Dovis 學到東西。",
    send: "送出給 Dovis",
    cancel: "取消",
    status: {
      proposed: "等你決定",
      modifying: "Dovis 重做中",
      confirmed: "已確認",
      executing: "執行中",
      done: "完成",
      rejected: "已退回",
      failed: "失敗",
    },
    action: { draft_email: "郵件草稿", manual: "需要你處理" },
    addAdmin: "新增助理",
    email: "電子郵件",
    username: "使用者名稱",
    displayName: "姓名",
    role: "角色",
    accountStatus: "狀態",
    allowModify: "允許修改",
    active: "啟用",
    paused: "已停用",
    pause: "停用",
    resume: "恢復",
    remove: "移除",
    owner: "擁有者",
    admin: "助理",
    tempPasswordIs: "臨時密碼",
    tempPasswordCopy: "請當面交給對方。他們第一次登入時必須更改密碼。",
    allowModifyWarningTitle: "要讓這位助理代替你操作嗎？",
    allowModifyWarningBody:
      "開啟後，他們可以確認、修改、退回你佇列中的項目。確認郵件項目會用你的名義，在「你的」Gmail 中寫入草稿。他們仍然不能刪除任何東西，也仍然不能寄出——寄出還是由你按。只有你願意讓他讀你信箱的人，才開啟這個選項。",
    enableAnyway: "確定開啟",
    removeAdminTitle: "要移除這個帳號嗎？",
    removeAdminBody: "對方會立即失去存取權限。此操作無法復原，只能重新建立帳號。",
    dangerZoneHint: "以下操作皆無法復原，且僅限擁有者。你的助理看不到也碰不到。",
    googleTitle: "Google 帳號",
    googleNotConnected: "尚未連結。在完成之前，Dovis 無法讀取你的郵件與行事曆。",
    googleConnect: "連結 Google",
    googleReconnect: "重新連結",
    googleConnected: "已連結",
    googleUnavailable:
      "這個部署沒有設定 Google 登入。此功能只在真正的 Dovis 主機上運作，示範站台不會有。",
    clearCta: "清除",
    deleteCta: "刪除",
    clearCompleted: "清除已完成項目",
    clearCompletedHint:
      "刪除所有已完成與已退回的項目，連同記錄在上面的草稿。Dovis 會失去這段歷史，也不再從中學習。",
    deleteAll: "刪除整個佇列",
    deleteAllHint: "移除所有狀態的項目，包含還在等你決定的。",
    typeToConfirm: "請輸入",
    toConfirm: "以確認",
    demoBanner: "示範資料。這裡沒有任何真實內容，也不會儲存——重新整理即可重置。",
    language: "語言",
    theme: "主題",
    refresh: "重新整理",
    refreshing: "更新中",
    newItems: "{n} 項佇列變動待更新",
    newItemsOne: "一項佇列變動待更新",
    showThem: "顯示",
    connectionStale: "重新連線中——內容可能不是最新",
    connectionOffline: "非即時——內容可能不是最新",
    refreshDemo: "示範資料不會自己變動。",
    payloadFailed: "無法載入內容。",
    draftsRestricted: "你的帳號可以檢視佇列，但看不到草稿內容。",
  },
};

export type Dict = (typeof dict)["en"];

/*
  Compile-time assertion that every language carries every key. Adding a string to
  `en` without adding it to `zh-TW` fails the build here rather than rendering
  `undefined` to a boss mid-sentence.
*/
export const languages: Record<Lang, Dict> = dict;

export const LangContext = createContext<{
  lang: Lang;
  /** The viewer chose this. Persists to their profile. */
  setLang: (l: Lang) => void;
  /**
   * The profile already said this. Applies it locally and does NOT write back.
   *
   * Separate from `setLang` on purpose: adopting the server's answer through the
   * setter would POST it straight back, which is a pointless round trip on every
   * sign-in and a race against a change made on another device in between.
   */
  adoptLang: (l: Lang) => void;
  t: Dict;
}>({ lang: "en", setLang: () => {}, adoptLang: () => {}, t: dict.en });

export function useI18n() {
  return useContext(LangContext);
}

export const LANG_STORAGE_KEY = "dovis.lang";
