/*
 * ExtensionInjectionManager — injects the chrome API shim + content scripts into WebView.
 */

package com.kioskbrowser.extension.bridge

import android.util.Log
import android.webkit.WebView
import com.kioskbrowser.AppConfig
import com.kioskbrowser.extension.ExtensionLoader

class ExtensionInjectionManager(
    private val extensionLoader: ExtensionLoader,
    private val bridge: ExtensionBridge,
    private val dispatcher: ExtensionEventDispatcher
) {
    companion object { private const val TAG = "ExtInjectionMgr" }

    fun injectApiShim(webView: WebView) {
        webView.evaluateJavascript(generateApiShim(), null)
        Log.d(TAG, "Extension API shim injected")
    }

    fun injectContentScripts(webView: WebView, url: String, runAt: String) {
        val scripts = extensionLoader.getContentScriptsForUrl(url).filter { it.runAt == runAt }
        for (cs in scripts) {
            for (cssFile in cs.css ?: emptyList()) {
                val css = extensionLoader.readExtensionFile(cssFile) ?: continue
                val escaped = css.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
                webView.evaluateJavascript("(function(){var s=document.createElement('style');s.textContent='$escaped';(document.head||document.documentElement).appendChild(s);})();", null)
            }
            for (jsFile in cs.js ?: emptyList()) {
                val js = extensionLoader.readExtensionFile(jsFile) ?: continue
                webView.evaluateJavascript("(function(){try{$js}catch(e){console.error('Content script err ($jsFile):',e);}})();", null)
            }
        }
    }

    fun injectBackgroundScript(webView: WebView) {
        val m = extensionLoader.manifest ?: return
        val bg = m.background
        val content = if (bg?.serviceWorker != null) extensionLoader.readExtensionFile(bg.serviceWorker)
        else if ((bg?.scripts ?: emptyList()).isNotEmpty()) (bg?.scripts ?: emptyList()).joinToString("\n") { extensionLoader.readExtensionFile(it) ?: "" }
        else null
        if (content != null) {
            webView.evaluateJavascript("(function(){try{$content console.log('BG script loaded');}catch(e){console.error('BG script err:',e);}})();", null)
            Log.d(TAG, "Background script injected")
        }
    }

    private fun generateApiShim(): String {
        val extId = AppConfig.EXTENSION_ID
        val bn = ExtensionBridge.INTERFACE_NAME
        return """
(function(){'use strict';
window.__kioskCallbacks={};var _c=0;
function mc(fn){if(!fn)return '';var i='cb_'+(++_c)+'_'+Date.now();window.__kioskCallbacks[i]=function(r){try{fn(JSON.parse(r))}catch(e){fn(r)}};return i;}
var b=window.$bn;
function bc(m){var a=Array.prototype.slice.call(arguments,1);return b[m].apply(b,a);}

var runtime={
id:'$extId',
getManifest:function(){return JSON.parse(bc('runtimeGetManifest'));},
getURL:function(p){return bc('runtimeGetURL',p);},
sendMessage:function(eid,msg,opts,cb){
if(typeof eid!=='string'){cb=opts;opts=msg;msg=eid;eid=null;}
if(typeof opts==='function'){cb=opts;opts={};}
bc('runtimeSendMessage',JSON.stringify(msg||{}),mc(cb));
},
connect:function(eid,ci){if(typeof eid!=='string'){ci=eid;eid=null;}
var cbid=mc(function(port){var po={name:port.name,sender:port.sender,
onMessage:{addListener:function(fn){_pl.push(fn);}},
onDisconnect:{addListener:function(fn){}},
postMessage:function(m){bc('runtimeSendMessage',JSON.stringify(m),'');},
disconnect:function(){}};window.__kioskPort=po;if(ci&&ci.onConnect)ci.onConnect(po);});
bc('runtimeConnect',eid||'',JSON.stringify(ci||{}),cbid);
},
onMessage:{_l:[],addListener:function(fn){this._l.push(fn);},removeListener:function(fn){this._l=this._l.filter(function(l){return l!==fn;});},hasListener:function(fn){return this._l.indexOf(fn)>=0;},hasListeners:function(){return this._l.length>0;}},
onConnect:{_l:[],addListener:function(fn){this._l.push(fn);},removeListener:function(fn){this._l=this._l.filter(function(l){return l!==fn;});},hasListener:function(fn){return this._l.indexOf(fn)>=0;},hasListeners:function(){return this._l.length>0;}},
onInstalled:{_l:[],addListener:function(fn){fn({reason:'install'});},removeListener:function(fn){},hasListener:function(fn){return false;},hasListeners:function(){return false;}},
getPlatformInfo:function(cb){bc('runtimeGetPlatformInfo',mc(cb));},
lastError:null,setUninstallURL:function(){},
openOptionsPage:function(cb){bc('runtimeGetURL','options.html');if(cb)cb();}
};
var _pl=[];
var storage={local:{
get:function(keys,cb){var r=JSON.parse(bc('storageLocalGet',keys?JSON.stringify(keys):null));if(cb)cb(r);return Promise.resolve(r);},
set:function(items,cb){bc('storageLocalSet',JSON.stringify(items));if(cb)cb();return Promise.resolve();},
remove:function(keys,cb){bc('storageLocalRemove',JSON.stringify(keys));if(cb)cb();return Promise.resolve();},
clear:function(cb){bc('storageLocalClear');if(cb)cb();return Promise.resolve();},
getBytesInUse:function(keys,cb){var r=parseInt(bc('storageLocalGetBytesInUse',keys?JSON.stringify(keys):null));if(cb)cb(r);return Promise.resolve(r);},
onChanged:{_l:[],addListener:function(fn){this._l.push(fn);},removeListener:function(fn){this._l=this._l.filter(function(l){return l!==fn;});},hasListener:function(fn){return this._l.indexOf(fn)>=0;}}
},
sync:{get:function(k,cb){return storage.local.get(k,cb);},set:function(i,cb){return storage.local.set(i,cb);},remove:function(k,cb){return storage.local.remove(k,cb);},clear:function(cb){return storage.local.clear(cb);},getBytesInUse:function(k,cb){return storage.local.getBytesInUse(k,cb);},onChanged:{addListener:function(){},removeListener:function(){},hasListener:function(){}}},
managed:{get:function(k,cb){if(cb)cb({});return Promise.resolve({});}}
};
var tabs={
TAB_ID_NONE:-1,
get:function(id,cb){bc('tabsGetCurrent',mc(cb));return new Promise(function(r){bc('tabsGetCurrent',mc(r));});},
getCurrent:function(cb){bc('tabsGetCurrent',mc(cb));return new Promise(function(r){bc('tabsGetCurrent',mc(r));});},
query:function(qi,cb){bc('tabsQuery',JSON.stringify(qi||{}),mc(cb));return new Promise(function(r){bc('tabsQuery',JSON.stringify(qi||{}),mc(r));});},
create:function(cp,cb){bc('tabsCreate',JSON.stringify(cp||{}),mc(cb));return new Promise(function(r){bc('tabsCreate',JSON.stringify(cp||{}),mc(r));});},
update:function(id,up,cb){bc('tabsUpdate',id,JSON.stringify(up||{}),mc(cb));return new Promise(function(r){bc('tabsUpdate',id,JSON.stringify(up||{}),mc(r));});},
executeScript:function(id,det,cb){bc('tabsExecuteScript',id||1,JSON.stringify(det),mc(cb));return new Promise(function(r){bc('tabsExecuteScript',id||1,JSON.stringify(det),mc(r));});},
insertCSS:function(id,det,cb){if(cb)cb();return Promise.resolve();},
remove:function(ids,cb){if(cb)cb();},
reload:function(id,bc,cb){if(cb)cb();},
onCreated:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onUpdated:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onRemoved:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onActivated:{addListener:function(){},removeListener:function(){},hasListener:function(){}}
};
var action={
setPopup:function(d){bc('actionSetPopup',JSON.stringify(d));return Promise.resolve();},
setTitle:function(d){bc('actionSetTitle',JSON.stringify(d));return Promise.resolve();},
setBadgeText:function(d){bc('actionSetBadgeText',JSON.stringify(d));return Promise.resolve();},
setBadgeBackgroundColor:function(d){bc('actionSetBadgeBackgroundColor',JSON.stringify(d));return Promise.resolve();},
setIcon:function(d){return Promise.resolve();},
enable:function(id){return Promise.resolve();},
disable:function(id){return Promise.resolve();},
onClicked:{_l:[],addListener:function(fn){this._l.push(fn);},removeListener:function(fn){this._l=this._l.filter(function(l){return l!==fn;});},hasListener:function(fn){return this._l.indexOf(fn)>=0;}},
getPopup:function(d,cb){if(cb)cb('');return Promise.resolve('');},
getTitle:function(d,cb){if(cb)cb('');return Promise.resolve('');},
getBadgeText:function(d,cb){if(cb)cb('');return Promise.resolve('');},
getBadgeBackgroundColor:function(d,cb){if(cb)cb([0,0,0,0]);return Promise.resolve([0,0,0,0]);}
};
var alarms={
create:function(n,ai){bc('alarmsCreate',n||'',JSON.stringify(ai||{}));return Promise.resolve();},
get:function(n,cb){if(cb)cb(null);return Promise.resolve(null);},
getAll:function(cb){bc('alarmsGetAll',mc(cb));return new Promise(function(r){bc('alarmsGetAll',mc(r));});},
clear:function(n,cb){bc('alarmsClear',n||'',mc(cb));return new Promise(function(r){bc('alarmsClear',n||'',mc(r));});},
clearAll:function(cb){bc('alarmsClearAll',mc(cb));return new Promise(function(r){bc('alarmsClearAll',mc(r));});},
onAlarm:{_l:[],addListener:function(fn){this._l.push(fn);},removeListener:function(fn){this._l=this._l.filter(function(l){return l!==fn;});},hasListener:function(fn){return this._l.indexOf(fn)>=0;}}
};
var notifications={
create:function(id,opts,cb){bc('notificationsCreate',id||'',JSON.stringify(opts||{}),mc(cb));return new Promise(function(r){bc('notificationsCreate',id||'',JSON.stringify(opts||{}),mc(r));});},
update:function(id,opts,cb){if(cb)cb(false);return Promise.resolve(false);},
clear:function(id,cb){bc('notificationsClear',id||'',mc(cb));return new Promise(function(r){bc('notificationsClear',id||'',mc(r));});},
getAll:function(cb){if(cb)cb({});return Promise.resolve({});},
onButtonClicked:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onClicked:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onClosed:{addListener:function(){},removeListener:function(){},hasListener:function(){}}
};
var webRequest={
onBeforeRequest:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onBeforeSendHeaders:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onSendHeaders:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onHeadersReceived:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onAuthRequired:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onResponseStarted:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onBeforeRedirect:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onCompleted:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
onErrorOccurred:{addListener:function(){},removeListener:function(){},hasListener:function(){}},
handlerBehaviorChanged:function(cb){if(cb)cb();return Promise.resolve();},
MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES:20
};
var scripting={
executeScript:function(inj){return tabs.executeScript(inj.target?inj.target.tabId:null,{code:inj.func?'('+inj.func.toString()+')()':null,file:inj.files?inj.files[0]:null});},
insertCSS:function(inj){return tabs.insertCSS(inj.target?inj.target.tabId:null,{code:inj.css||'',file:inj.files?inj.files[0]:null});},
removeCSS:function(inj){return Promise.resolve();}
};
var i18n={
getMessage:function(n,s){return n;},
getAcceptLanguages:function(cb){var l=['en'];if(cb)cb(l);return Promise.resolve(l);},
getUILanguage:function(){return 'en';},
detectLanguage:function(t,cb){if(cb)cb({languages:[]});}
};
var windows={
WINDOW_ID_NONE:-1,WINDOW_ID_CURRENT:-2,
getCurrent:function(gi,cb){var w={id:1,focused:true,top:0,left:0,width:screen.width,height:screen.height,alwaysOnTop:true,incognito:false,type:'normal',state:'fullscreen'};if(cb)cb(w);return Promise.resolve(w);},
getAll:function(gi,cb){var w={id:1,focused:true,state:'fullscreen'};if(cb)cb([w]);return Promise.resolve([w]);},
create:function(cd,cb){if(cb)cb({id:1});return Promise.resolve({id:1});},
update:function(wid,ui,cb){if(cb)cb({id:1});return Promise.resolve({id:1});},
onFocusChanged:{addListener:function(){},removeListener:function(){},hasListener:function(){}}
};
var extension={
getURL:function(p){return runtime.getURL(p);},
getBackgroundPage:function(){return null;},
getViews:function(fp){return [window];},
isAllowedIncognitoAccess:function(cb){if(cb)cb(false);return Promise.resolve(false);},
isAllowedFileSchemeAccess:function(cb){if(cb)cb(false);return Promise.resolve(false);}
};

if(typeof chrome==='undefined')window.chrome={};
chrome.runtime=chrome.runtime||runtime;
chrome.storage=chrome.storage||storage;
chrome.tabs=chrome.tabs||tabs;
chrome.action=chrome.action||action;
chrome.browserAction=chrome.browserAction||action;
chrome.alarms=chrome.alarms||alarms;
chrome.notifications=chrome.notifications||notifications;
chrome.webRequest=chrome.webRequest||webRequest;
chrome.scripting=chrome.scripting||scripting;
chrome.i18n=chrome.i18n||i18n;
chrome.windows=chrome.windows||windows;
chrome.extension=chrome.extension||extension;
if(typeof browser==='undefined')window.browser=chrome;
console.log('[KioskBrowser] Extension API shim loaded. chrome.runtime.id = '+chrome.runtime.id);
})();
""".trimIndent()
    }
}
