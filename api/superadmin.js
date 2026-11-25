import { getSessionEmployee, refreshSiteDisabledCache } from './_session.js';
import { supabaseFetch } from './_supabase.js';

const pages = new Set(['clock','employee-profile','my-attendance','team-attendance','insights','employees','shifts','leaves','reports','settings','crm-customers','crm-tasks','crm-meetings','crm-inventory','crm-sales','crm-purchases','crm-invoices','crm-receipts','crm-portal','crm-notifications','live-dashboard']);
const roles = new Set(['admin','employee','accounts','ceo']);
const json = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
function reply(res,status,data){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(status).json(data);}

export default async function handler(req,res){
  try{
    const token=String(req.headers['x-session-token']||'').trim();
    const actor=token?await getSessionEmployee(token):null;
    if(!actor?.isSuperAdmin)return reply(res,403,{error:'Super Admin access required.'});
    if(req.method==='GET'){
      const [rows,settingsRows]=await Promise.all([
        supabaseFetch('/employees?deleted_at=is.null&select=id,employee_code,name,email,role,is_active,page_access&order=name.asc'),
        supabaseFetch('/settings?id=eq.current&select=data'),
      ]);
      return reply(res,200,{employees:(rows||[]).filter(e=>e.role!=='superadmin').map(e=>({id:e.id,employeeCode:e.employee_code,name:e.name,email:e.email||'',role:e.role||'employee',isActive:e.is_active!==false,featureAccess:e.page_access||{}})),siteDisabled:json(settingsRows?.[0]?.data).siteDisabled===true,pages:[...pages]});
    }
    if(req.method!=='POST')return reply(res,405,{error:'Method not allowed.'});
    const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});
    const now=new Date().toISOString();
    if(body.action==='site-status'){
      const rows=await supabaseFetch('/settings?id=eq.current&select=data');
      if(!rows?.[0])return reply(res,404,{error:'Office settings are unavailable.'});
      const data=json(rows[0].data);
      const disabled=body.disabled===true;
      await supabaseFetch('/settings?id=eq.current',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({data:{...data,siteDisabled:disabled,siteDisabledAt:disabled?now:null,siteDisabledBy:disabled?actor.id:null,settingsUpdatedAt:now}})});
      refreshSiteDisabledCache(disabled);
      return reply(res,200,{ok:true,siteDisabled:disabled});
    }
    const id=String(body.employeeId||'');
    if(!id||id===actor.id)return reply(res,400,{error:'Choose a current employee account.'});
    const rows=await supabaseFetch(`/employees?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=id,role,page_access,is_active`);
    const target=rows?.[0];
    if(!target||target.role==='superadmin')return reply(res,404,{error:'Employee not found.'});
    if(body.action==='page-access'){
      if(!pages.has(body.page)||typeof body.enabled!=='boolean')return reply(res,400,{error:'Invalid page access change.'});
      const access={...(target.page_access||{}),[body.page]:body.enabled};
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({page_access:access,record_updated_at:now,last_edited_by_role:'superadmin'})});
      return reply(res,200,{ok:true,featureAccess:access});
    }
    if(body.action==='employee-role'){
      if(!roles.has(body.role))return reply(res,400,{error:'Invalid employee role.'});
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({role:body.role,record_updated_at:now,last_edited_by_role:'superadmin'})});
      return reply(res,200,{ok:true,role:body.role});
    }
    if(body.action==='employee-status'){
      if(typeof body.enabled!=='boolean')return reply(res,400,{error:'Invalid profile status.'});
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({is_active:body.enabled,record_updated_at:now,last_edited_by_role:'superadmin'})});
      return reply(res,200,{ok:true,isActive:body.enabled});
    }
    if(body.action==='employee-remove'){
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({is_active:false,deleted_at:now,record_updated_at:now,last_edited_by_role:'superadmin'})});
      return reply(res,200,{ok:true,removed:true});
    }
    return reply(res,400,{error:'Unknown Super Admin action.'});
  }catch(error){return reply(res,Number(error?.status)||500,{error:error?.message||'Super Admin action failed.'});}
}
