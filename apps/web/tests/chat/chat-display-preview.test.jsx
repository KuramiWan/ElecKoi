import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPanel } from "../../src/modules/settings/components/SettingsPanel.jsx";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../../../packages/shared/src/contracts/settings/schemas.ts";
import { WithOfficialMarkdown } from "../helpers/officialMarkdown.jsx";

globalThis.React = React;

describe("chat display preview", () => {
  it("shows the same rich message count and bounds as mobile only when limits are enabled", () => {
    const render = enabled => renderToStaticMarkup(React.createElement(WithOfficialMarkdown, null,
      React.createElement(SettingsPanel, { activePage: "chat", chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        rich_message_limit_enabled: enabled, rich_message_floor_limit: 7 }, onChatDisplayChange: () => {},
        renderLayout: ({ mainPanel }) => mainPanel })));
    expect(render(false)).toContain('限制富消息运行楼层');
    expect(render(false)).not.toContain('自动运行楼层数数值');
    const html = render(true);
    expect(html).toContain('aria-label="自动运行楼层数数值"');
    expect(html).toMatch(/aria-label="自动运行楼层数数值" min="1" step="1" value="7"/);
    expect(html).not.toMatch(/aria-label="自动运行楼层数数值"[^>]* max=/);
  });
  it("uses the active persona without a fixed conversation title", () => {
    const html = renderToStaticMarkup(React.createElement(WithOfficialMarkdown, null,
      React.createElement(SettingsPanel, {
        activePage: "chat",
        persona: { user_name: "访客乙", assistant_name: "角色甲" },
        chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, layout: "agent" },
        onChatDisplayChange: () => {},
        renderLayout: ({ mainPanel }) => mainPanel,
      }),
    ));

    expect(html).toContain("访客乙");
    expect(html).toContain("角色甲");
    expect(html).not.toContain("chat-display-preview-bar");
  });

  it("places roleplay message switches in their own settings section", () => {
    const html = renderToStaticMarkup(React.createElement(WithOfficialMarkdown, null,
      React.createElement(SettingsPanel, {
        activePage: "chat",
        chatDisplay: DEFAULT_CHAT_DISPLAY_PREFERENCES,
        onChatDisplayChange: () => {},
        renderLayout: ({ mainPanel }) => mainPanel,
      }),
    ));
    const sectionContaining = (label) => {
      const heading = html.indexOf(`<strong>${label}</strong>`);
      return html.slice(html.lastIndexOf("<section", heading), html.indexOf("</section>", heading));
    };

    expect(sectionContaining("消息信息")).toContain("聊天时间戳");
    expect(sectionContaining("消息信息")).toContain("显示消息楼层");
    expect(sectionContaining("头像与名字")).not.toContain("聊天时间戳");
    expect(sectionContaining("头像与名字")).not.toContain("显示消息楼层");
  });
});
