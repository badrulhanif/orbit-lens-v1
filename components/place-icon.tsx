import {
  ActivityIcon,
  BanknoteIcon,
  CloudLightningIcon,
  FlameIcon,
  LandPlotIcon,
  MountainSnowIcon,
  WavesIcon,
  Building2Icon,
  CarIcon,
  CoffeeIcon,
  DumbbellIcon,
  FuelIcon,
  GraduationCapIcon,
  HospitalIcon,
  HotelIcon,
  LandmarkIcon,
  MapIcon,
  MapPinIcon,
  PillIcon,
  PlaneIcon,
  RouteIcon,
  ShieldIcon,
  ShoppingBagIcon,
  TrainFrontIcon,
  TreesIcon,
  UtensilsIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"

import type { PlaceIcon as PlaceIconName } from "@/lib/geo"
import { cn } from "@/lib/utils"

const ICONS: Record<PlaceIconName, LucideIcon> = {
  pin: MapPinIcon,
  area: MapIcon,
  street: RouteIcon,
  building: Building2Icon,
  shop: ShoppingBagIcon,
  food: UtensilsIcon,
  cafe: CoffeeIcon,
  fuel: FuelIcon,
  ev: ZapIcon,
  health: HospitalIcon,
  pharmacy: PillIcon,
  worship: LandmarkIcon,
  money: BanknoteIcon,
  education: GraduationCapIcon,
  lodging: HotelIcon,
  park: TreesIcon,
  transit: TrainFrontIcon,
  air: PlaneIcon,
  car: CarIcon,
  police: ShieldIcon,
  fitness: DumbbellIcon,
  flood: WavesIcon,
  landslide: LandPlotIcon,
  quake: ActivityIcon,
  volcano: MountainSnowIcon,
  storm: CloudLightningIcon,
  fire: FlameIcon,
}

export function PlaceIcon({
  icon,
  className,
}: {
  icon: PlaceIconName
  className?: string
}) {
  const Icon = ICONS[icon] ?? MapPinIcon
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-muted text-foreground/70 [&_svg]:size-4",
        className
      )}
    >
      <Icon />
    </span>
  )
}
