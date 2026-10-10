import type { WidgetPlugin } from './types.ts';

export const awayWidget: WidgetPlugin = {
  type:'away',version:1,label:'자리 비움 / 상태',description:'An operator-authored scene status, independent of session lifecycle.',sourcePaths:[],settingsKeys:['message','detail','showDetails'],defaults:{fontSize:52,padding:40,maxLines:4},
  project:(_context,settings)=>[{path:'/widget/message',text:settings.message,role:'heading'},...(settings.showDetails&&settings.detail?[{path:'/widget/detail',text:settings.detail,role:'body'} as const]:[])]
};
