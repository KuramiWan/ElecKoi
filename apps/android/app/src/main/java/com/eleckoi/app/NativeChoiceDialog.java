package com.eleckoi.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Typeface;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.CheckedTextView;
import android.widget.ListView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;

/** Shared Android choice presentation; each browser owns its request and selection semantics. */
final class NativeChoiceDialog {
    enum Mode { MENU, SINGLE, MULTIPLE }
    static final class Item {
        final String id, label;
        final boolean disabled, selected, separator;
        final List<Item> children;
        Item(String id,String label,boolean disabled,boolean selected,boolean separator,List<Item> children) {
            this.id=id; this.label=label; this.disabled=disabled; this.selected=selected; this.separator=separator; this.children=children;
        }
    }
    interface Completion {
        void complete(String[] selectedIds);
        void failed(Exception error);
    }
    private final Activity activity;
    private final BooleanSupplier dark;
    private Selection active;
    NativeChoiceDialog(Activity activity,BooleanSupplier dark) { this.activity=activity; this.dark=dark; }
    void show(String title,String message,Mode mode,List<Item> items,Completion completion) {
        dismiss();
        if(activity.isFinishing() || activity.isDestroyed()) { completion.complete(null); return; }
        active=new Selection(completion);
        update(title,message,mode,items);
    }
    void update(String title,String message,Mode mode,List<Item> items) {
        if(active==null) throw new IllegalStateException("Choice prompt is no longer active");
        Selection selection=active; selection.hide();
        try { selection.show(title,message,mode,items); }
        catch(RuntimeException error) { selection.fail(error); }
    }
    void dismiss() { if(active!=null) active.finish(null); }

    private final class Selection {
        final Completion completion;
        AlertDialog dialog;
        boolean completed;
        Selection(Completion completion) { this.completion=completion; }
        void show(String title,String message,Mode mode,List<Item> items) {
            boolean multiple=mode==Mode.MULTIPLE;
            AlertDialog.Builder builder=new AlertDialog.Builder(activity,dark.getAsBoolean()
                ? android.R.style.Theme_Material_Dialog_Alert : android.R.style.Theme_Material_Light_Dialog_Alert);
            if(title!=null && !title.isEmpty()) builder.setTitle(title);
            if(message!=null && !message.isEmpty()) builder.setMessage(message);
            Choices adapter=new Choices(builder.getContext(),items,mode);
            builder.setAdapter(adapter,null);
            builder.setNegativeButton(android.R.string.cancel,(ignored,which)->finish(null));
            if(multiple) builder.setPositiveButton(android.R.string.ok,(ignored,which)->{
                if(completed) return;
                List<String> ids=new ArrayList<>(); ListView list=dialog.getListView();
                for(int index=0;index<adapter.getCount();index++) {
                    Row row=adapter.getItem(index);
                    if(!row.heading && list.isItemChecked(index)) ids.add(row.item.id);
                }
                finish(ids.toArray(new String[0]));
            });
            dialog=builder.create();
            dialog.setOnCancelListener(ignored->finish(null));
            dialog.setOnDismissListener(ignored->finish(null));
            dialog.show();
            ListView list=dialog.getListView();
            list.setChoiceMode(multiple ? ListView.CHOICE_MODE_MULTIPLE : mode==Mode.SINGLE ? ListView.CHOICE_MODE_SINGLE : ListView.CHOICE_MODE_NONE);
            int selected=-1;
            for(int index=0;index<adapter.getCount();index++) {
                Row row=adapter.getItem(index);
                if(!row.heading && row.item.selected) { list.setItemChecked(index,true); if(selected==-1) selected=index; }
            }
            if(selected>=0) list.setSelection(selected);
            list.setOnItemClickListener((parent,view,position,id)->{
                if(completed || !adapter.isEnabled(position)) return;
                if(!multiple) finish(new String[]{adapter.getItem(position).item.id});
            });
        }
        void finish(String[] ids) {
            if(completed) return;
            completed=true; hide(); if(active==this) active=null;
            completion.complete(ids);
        }
        void fail(Exception error) {
            if(completed) return;
            completed=true; hide(); if(active==this) active=null;
            completion.failed(error);
        }
        void hide() {
            if(dialog==null) return;
            dialog.setOnCancelListener(null); dialog.setOnDismissListener(null); dialog.dismiss(); dialog=null;
        }
    }
    private static final class Row {
        final Item item;
        final boolean heading, disabled;
        final int depth;
        Row(Item item,boolean disabled,int depth) {
            this.item=item; heading=item.children!=null || item.separator;
            this.disabled=disabled || item.disabled || heading; this.depth=depth;
        }
    }
    private static final class Choices extends BaseAdapter {
        final Context context; final Mode mode; final List<Row> rows=new ArrayList<>();
        Choices(Context context,List<Item> items,Mode mode) { this.context=context; this.mode=mode; add(items,false,0); }
        void add(List<Item> items,boolean disabled,int depth) {
            for(Item item:items) {
                rows.add(new Row(item,disabled,depth));
                if(item.children!=null) add(item.children,disabled || item.disabled,depth+1);
            }
        }
        @Override public int getCount() { return rows.size(); }
        @Override public Row getItem(int position) { return rows.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean areAllItemsEnabled() { return false; }
        @Override public boolean isEnabled(int position) { return !getItem(position).disabled; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public int getItemViewType(int position) { return getItem(position).heading ? 1 : 0; }
        @Override public View getView(int position,View recycled,ViewGroup parent) {
            Row row=getItem(position);
            int layout=row.heading || mode==Mode.MENU ? android.R.layout.simple_list_item_1
                : mode==Mode.MULTIPLE ? android.R.layout.select_dialog_multichoice : android.R.layout.select_dialog_singlechoice;
            TextView text=recycled instanceof TextView ? (TextView)recycled : (TextView)LayoutInflater.from(context).inflate(layout,parent,false);
            text.setText(row.item.separator ? "" : row.item.label); text.setEnabled(!row.disabled);
            text.setTypeface(null,row.heading ? Typeface.BOLD : Typeface.NORMAL);
            float density=context.getResources().getDisplayMetrics().density;
            text.setPaddingRelative(Math.round((24+16*row.depth)*density),text.getPaddingTop(),Math.round(24*density),text.getPaddingBottom());
            if(text instanceof CheckedTextView) ((CheckedTextView)text).setChecked(row.item.selected);
            return text;
        }
    }
}
