import type {ActiveDesktopTab,Employee} from '../types';

export const PAGE_ACCESS_OPTIONS:{id:ActiveDesktopTab;label:string}[]=[
  {id:'clock',label:'Punch Clock'},{id:'employee-profile',label:'My Profile'},{id:'my-attendance',label:'My Attendance & Stats'},
  {id:'team-attendance',label:'Team Presence'},{id:'live-dashboard',label:'Live Dashboard'},{id:'leaves',label:'Leave Requests'},
  {id:'insights',label:'Insights'},{id:'employees',label:'Employee Directory'},{id:'shifts',label:'Shift Management'},
  {id:'reports',label:'Reports'},{id:'settings',label:'Office Settings'},{id:'crm-customers',label:'Customers'},
  {id:'crm-tasks',label:'Tasks & Follow-ups'},{id:'crm-meetings',label:'Meetings'},{id:'crm-inventory',label:'Inventory'},
  {id:'crm-sales',label:'Sales'},{id:'crm-purchases',label:'Purchases'},{id:'crm-invoices',label:'Invoices'},
  {id:'crm-receipts',label:'Receipts'},{id:'crm-portal',label:'Customer Portal'},{id:'crm-notifications',label:'CRM Notifications'},
];
export function pageEnabled(employee:Employee|undefined,page:ActiveDesktopTab){
  if(!employee||employee.isSuperAdmin)return true;
  return employee.featureAccess?.[page]!==false;
}
