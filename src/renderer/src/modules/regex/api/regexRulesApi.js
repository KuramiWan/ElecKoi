import { desktopClient } from "../../../bridge/desktopClient.ts";

export function testRegexRule(text, rule, target) {
  return desktopClient.request("command.regex_rules.test", { text, rule, target });
}
