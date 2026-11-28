import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
const searchSchema=z.object({view:z.enum(["home","library","search","discover","detail","read"]).optional(),id:z.coerce.number().optional(),chapter:z.coerce.number().nonnegative().optional(),q:z.string().optional(),sort:z.string().optional(),country:z.enum(["JP","KR","CN"]).optional()})
export const Route=createFileRoute("/_main/manga/")({validateSearch:searchSchema})
