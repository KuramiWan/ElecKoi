package com.eleckoi.app;

import android.app.Activity;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession.PromptDelegate.*;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;

/** Maps Gecko's formal choice IDs and lifecycle to the shared native selection UI. */
final class GeckoChoicePrompts {
    private final NativeChoiceDialog dialog;
    GeckoChoicePrompts(Activity activity,BooleanSupplier dark) { dialog=new NativeChoiceDialog(activity,dark); }
    GeckoResult<PromptResponse> show(ChoicePrompt prompt) {
        Selection selection=new Selection(prompt);
        dialog.show(prompt.title,prompt.message,mode(prompt.type),items(prompt.choices),selection);
        return selection.result;
    }
    void dismiss() { dialog.dismiss(); }
    private final class Selection implements PromptInstanceDelegate,NativeChoiceDialog.Completion {
        final GeckoResult<PromptResponse> result=new GeckoResult<>();
        ChoicePrompt prompt;
        boolean completed;
        Selection(ChoicePrompt prompt) { this.prompt=prompt; prompt.setDelegate(this); }
        @Override public void complete(String[] ids) {
            if(completed) return;
            completed=true; prompt.setDelegate(null);
            result.complete(ids==null ? prompt.dismiss() : prompt.confirm(ids));
        }
        @Override public void failed(Exception error) {
            if(completed) return;
            completed=true; prompt.setDelegate(null); prompt.dismiss(); result.completeExceptionally(error);
        }
        @Override public void onPromptDismiss(BasePrompt dismissed) { if(!completed) dialog.dismiss(); }
        @Override public void onPromptUpdate(BasePrompt updated) {
            if(completed) return;
            prompt.setDelegate(null); prompt=(ChoicePrompt)updated; prompt.setDelegate(this);
            dialog.update(prompt.title,prompt.message,mode(prompt.type),items(prompt.choices));
        }
    }
    private static NativeChoiceDialog.Mode mode(int type) {
        switch(type) {
            case ChoicePrompt.Type.MENU: return NativeChoiceDialog.Mode.MENU;
            case ChoicePrompt.Type.SINGLE: return NativeChoiceDialog.Mode.SINGLE;
            case ChoicePrompt.Type.MULTIPLE: return NativeChoiceDialog.Mode.MULTIPLE;
            default: throw new IllegalArgumentException("Unsupported Gecko choice type: "+type);
        }
    }
    private static List<NativeChoiceDialog.Item> items(ChoicePrompt.Choice[] choices) {
        List<NativeChoiceDialog.Item> items=new ArrayList<>();
        for(ChoicePrompt.Choice choice:choices) items.add(new NativeChoiceDialog.Item(choice.id,choice.label,choice.disabled,choice.selected,choice.separator,
            choice.items==null ? null : items(choice.items)));
        return items;
    }
}
