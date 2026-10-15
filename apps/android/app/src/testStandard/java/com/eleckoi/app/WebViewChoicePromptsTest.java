package com.eleckoi.app;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class WebViewChoicePromptsTest {
    private JSONObject request(String choices) throws Exception {
        return new JSONObject("{\"multiple\":false,\"choices\":"+choices+"}");
    }
    private String option(String id) {
        return "{\"id\":\""+id+"\",\"label\":\"Synthetic option\",\"disabled\":false,\"selected\":false,\"items\":null}";
    }
    @Test public void acceptsExplicitSingleAndMultipleModesWithStableChoiceIds() throws Exception {
        JSONObject input=request("["+option("option-a")+","+option("option-b")+"]");
        WebViewChoicePrompts.Request single=WebViewChoicePrompts.parse(input);
        assertEquals(NativeChoiceDialog.Mode.SINGLE,single.mode);
        assertEquals("option-a",single.items.get(0).id); assertEquals("option-b",single.items.get(1).id);
        input.put("multiple",true);
        assertEquals(NativeChoiceDialog.Mode.MULTIPLE,WebViewChoicePrompts.parse(input).mode);
    }
    @Test public void preservesExplicitDisabledGroupsAndChildSelection() throws Exception {
        String child=option("child").replace("\"selected\":false","\"selected\":true");
        String group="{\"id\":\"group\",\"label\":\"Synthetic group\",\"disabled\":true,\"selected\":false,\"items\":["+child+"]}";
        NativeChoiceDialog.Item item=WebViewChoicePrompts.parse(request("["+group+"]")).items.get(0);
        assertTrue(item.disabled); assertTrue(item.children.get(0).selected);
    }
    @Test public void rejectsDuplicateIdsAndMalformedFieldsInsteadOfGuessingChoices() throws Exception {
        for(JSONObject input:new JSONObject[]{request("["+option("same")+","+option("same")+"]"),
            request("["+option("")+"]"),request("["+option("a").replace("\"disabled\":false","\"disabled\":\"false\"")+"]"),
            request("[]").put("multiple","single")}) {
            try { WebViewChoicePrompts.parse(input); fail("Malformed choice request was accepted"); }
            catch(IllegalArgumentException expected) { assertNotNull(expected.getMessage()); }
        }
    }
}
