// @vitest-environment jsdom
// 判据来源：ADR 0002 决定 12 的第二处具体失败（`notes/eh-explore-renderer.md` §2：列表刷新失败时
// `refresh()` 的拒绝被吃掉、`projects` 保持 `[]`，页面显示「还没有创作项目」——用户以为项目没了）。
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreatorStudioProjectHome } from "../apps/web/src/modules/creatorStudio/components/CreatorStudioProjectHome.jsx";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const mounted = [];

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => { root.render(element); });
  return container;
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.innerHTML = "";
});

function catalogOf({ items = [], failure = null, refresh }) {
  return {
    getSnapshot: () => (failure ? { status: "error", error: failure } : { status: "ready", collection: { items } }),
    subscribe: () => () => {},
    refresh: refresh || (failure ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue({ items })),
  };
}

describe("创作项目首页的列表失败面", () => {
  it("刷新被拒：出现就地失败面（码 + 详情），不显示空列表文案", async () => {
    const failure = {
      isDSHRemoteError: true,
      code: "eleckoi/io/failed",
      message: "读取项目索引失败",
      details: { operation: "read", path: "/tmp/eleckoi/projects.json" },
    };
    const container = await mount(<CreatorStudioProjectHome
      characterCatalog={catalogOf({ failure })}
      projectCatalog={catalogOf({ failure })}
    />);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("读取失败");
    expect(alert.textContent).toContain("eleckoi/io/failed");
    expect(alert.textContent).toContain("/tmp/eleckoi/projects.json");
    expect(container.textContent).not.toContain("还没有创作项目");
  });

  it("刷新成功：列表照常显示，没有失败面", async () => {
    const container = await mount(<CreatorStudioProjectHome
      characterCatalog={catalogOf({})}
      projectCatalog={catalogOf({ items: [{ id: "p1", name: "项目甲", updatedAt: "2026-10-08T00:00:00.000Z" }] })}
    />);

    expect(container.textContent).toContain("项目甲");
    expect(container.querySelector(".failure-alert")).toBeNull();
  });
});
