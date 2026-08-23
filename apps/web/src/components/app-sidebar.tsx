import { useTranslation } from "react-i18next";
import { GalleryVerticalEnd, type LucideIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Select } from "@/components/ui/native-select";

export type NavItem = {
  id: string;
  key: string;
  badge: string;
  icon: LucideIcon;
};

export type NavGroup = {
  key: string;
  items: NavItem[];
};

export type AppSidebarProps = {
  groups: readonly NavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  primaryActionLabel: string;
  primaryActionStatus: string;
  runtimeLabel: string;
};

export function AppSidebar({
  groups,
  activeId,
  onSelect,
  primaryActionLabel,
  primaryActionStatus,
  runtimeLabel,
}: AppSidebarProps) {
  const { t, i18n } = useTranslation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="#run" onClick={() => onSelect("run")}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-xs font-extrabold text-primary-foreground">
                  AP
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Agent Platform</span>
                  <span className="text-xs text-muted-foreground">{t("nav.console")}</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={primaryActionLabel}
              className="border border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100 hover:text-blue-900 data-[active=true]:bg-blue-100"
              asChild
            >
              <a href="#run" onClick={() => onSelect("run")}>
                <GalleryVerticalEnd className="size-4 text-blue-700" />
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">{primaryActionLabel}</span>
                  <span className="text-xs text-blue-700">{primaryActionStatus}</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-2">
        {groups.map((group) => (
          <Collapsible
            key={group.key}
            defaultOpen
            className="group/collapsible"
          >
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center">
                  {t(`nav.groups.${group.key}`)}
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeId === item.id;
                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            size="lg"
                            tooltip={`${item.badge} · ${t(`nav.descriptions.${item.key}`)}`}
                          >
                            <a
                              href={`#${item.id}`}
                              aria-current={isActive ? "page" : undefined}
                              onClick={() => onSelect(item.id)}
                            >
                              <Icon />
                              <span className="flex flex-col leading-tight">
                                <span className="font-semibold">{t(`nav.${item.key}`)}</span>
                                <span className="text-xs text-muted-foreground">
                                  <span className="font-extrabold">{item.badge}</span>
                                  {" · "}
                                  {t(`nav.descriptions.${item.key}`)}
                                </span>
                              </span>
                            </a>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50 px-2.5 py-2 text-xs">
          <span className="text-muted-foreground">{t("nav.runtime")}</span>
          <strong className="text-primary">{runtimeLabel}</strong>
        </div>
        <Label className="grid gap-1.5 text-xs text-muted-foreground">
          <span>{t("language.label")}</span>
          <Select
            value={i18n.resolvedLanguage || i18n.language}
            onChange={(event) => void i18n.changeLanguage(event.target.value)}
          >
            <option value="zh-Hant">{t("language.zhHant")}</option>
            <option value="en">{t("language.en")}</option>
          </Select>
        </Label>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
