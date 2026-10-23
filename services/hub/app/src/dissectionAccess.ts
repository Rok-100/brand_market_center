import type {HubSession} from './types';
export function canAccessDissection(session:HubSession){
  return session.permissions.manage_permissions||session.workspace.is_system_maintainer||
    (session.workspace.is_brand_department&&['director','manager','specialist'].includes(session.workspace.role));
}
