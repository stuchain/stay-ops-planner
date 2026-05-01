import { requireAppPolicy } from "@/modules/auth/appAuth";
import { AdminConfigurationView } from "@/modules/admin-configuration/ui/AdminConfigurationView";

export default async function AdminConfigurationPage() {
  await requireAppPolicy("app_admin_configuration");
  return <AdminConfigurationView />;
}
