import Page from "@/app/(main)/entry/page"
import { createLazyFileRoute } from "@tanstack/react-router"
export const Route = createLazyFileRoute("/_main/entry/")({component:Page})
