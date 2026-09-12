import {defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {chainConfig} from "@/lib/config/chain";

export const GET = defineHandler(routes.getChains, async () => ({chains: [chainConfig()]}));
