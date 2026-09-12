import {defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {assetCatalogue} from "@/lib/config/assets";

export const GET = defineHandler(routes.listAssets, async () => ({assets: assetCatalogue()}));
