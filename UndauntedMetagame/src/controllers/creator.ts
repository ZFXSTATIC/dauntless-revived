import { eq } from "drizzle-orm";
import { GetDb } from "../db";
import { inventory, onetimejobs } from "../db/schema";
import { GetActiveCharacter } from "./activecharacter";
import { GrantEntitlementInTx } from "./entitlements";
import { StoreError } from "./freestore";
import { ApplyInventoryTransactionInTx } from "./inventory";

type StackedReward = {catalogId: string, quantity: number};

type CreatorCode = {
    // Name shown back to the client; matched case-insensitively with spaces trimmed.
    code: string,
    // Lower-case slug, also the receipt key: creator:<slug>:<accountId>.
    slug: string,
    // Added to the active character's inventory.
    items: readonly StackedReward[],
    // Timed account entitlement (duration in hours), if any.
    entitlement?: {name: string, duration: number}
};

export const CREATOR_REWARD_RAMS = 10000;

// The five orbs of 1.4.4 (ORB_TEST is a dev item and is left out).
const ORBS = ["ORB_FLAME", "ORB_FROST", "ORB_SHOCK", "ORB_TERRA", "ORB_PHYSICAL"];

// The timed escalation XP boost the Elite ranks hand out (progression_config.json, duration in hours).
const ESCALATION_BOOST = {name: "escalation_xp_boost_entitlement", duration: 48};

// Table order decides which code GET /creator reports when an account redeemed several.
export const CREATOR_CODES: readonly CreatorCode[] = [
    {code: "Void", slug: "void", items: [{catalogId: "CURRENCY_NOTES", quantity: CREATOR_REWARD_RAMS}]},
    {code: "TheFool", slug: "thefool", items: ORBS.map((catalogId) => ({catalogId, quantity: 20}))},
    {code: "ZFXSTATIC", slug: "zfxstatic", items: [], entitlement: ESCALATION_BOOST},
    {code: "ZEDFXSTATIC", slug: "zedfxstatic", items: [], entitlement: ESCALATION_BOOST}
];

const ReceiptId = (Code: CreatorCode, AccountId: string) => `creator:${Code.slug}:${AccountId}`;
const Reply = (Code: CreatorCode | undefined) => ({
    success: Code !== undefined,
    slug: Code?.code ?? "",
    expirationDate: "2099-01-01T00:00:00.000Z"
});

const FindCode = (Slug: unknown) => typeof Slug === "string" && Slug.length <= 64
    ? CREATOR_CODES.find((Code) => Code.slug === Slug.trim().toLowerCase())
    : undefined;

// Permanent account receipt: inventory transaction receipts expire and are character-scoped.
export function GetCreatorSupport(AccountId: string){
    const Db = GetDb();
    return Reply(CREATOR_CODES.find((Code) => Db.select().from(onetimejobs).where(eq(onetimejobs.jobId, ReceiptId(Code, AccountId))).get() !== undefined));
}

export function RedeemCreatorCode(AccountId: string, Slug: unknown){
    const Code = FindCode(Slug);
    if(!Code){
        throw new StoreError(404, "Creator code not found");
    }

    return GetDb().transaction((tx) => {
        if(tx.select().from(onetimejobs).where(eq(onetimejobs.jobId, ReceiptId(Code, AccountId))).get()){
            throw new StoreError(409, `${Code.code} has already been redeemed on this account`);
        }
        const Character = GetActiveCharacter(tx, AccountId);
        if(!Character) throw new StoreError(409, `Create a character before redeeming ${Code.code}`);

        if(Code.items.length > 0){
            const Saved = tx.select({stackedItems: inventory.stackedItems}).from(inventory).where(eq(inventory.characterId, Character.characterId)).get();
            const Held = Saved ? JSON.parse(Saved.stackedItems) : [];
            for(const Item of Code.items){
                const Balance = Held.find((Stack: any) => Stack.catalogId === Item.catalogId)?.quantity ?? 0;
                // Native inventory quantities are signed 32-bit integers.
                if(!Number.isSafeInteger(Balance) || Balance < 0 || Balance > 2147483647 - Item.quantity){
                    throw new StoreError(409, Item.catalogId === "CURRENCY_NOTES"
                        ? "Rams balance cannot receive this reward"
                        : `${Item.catalogId} cannot receive this reward`);
                }
            }
        }

        tx.insert(onetimejobs).values({jobId: ReceiptId(Code, AccountId), doneDate: new Date().toISOString()}).run();
        if(Code.items.length > 0){
            ApplyInventoryTransactionInTx(tx, {
                UserId: AccountId,
                CharacterId: Character.characterId,
                TransactionId: ReceiptId(Code, AccountId),
                StackedItemsToAdd: Code.items.map((Item) => ({...Item}))
            }, {Caller: "store", Source: `creator:${Code.code}`});
        }
        if(Code.entitlement){
            GrantEntitlementInTx(tx as never, AccountId, Code.entitlement.name, Code.entitlement.duration, `creator:${Code.code}`);
        }

        if(Code.slug === "void"){
            return {...Reply(Code), grantedRams: CREATOR_REWARD_RAMS, refreshInventory: true};
        }
        return {
            ...Reply(Code),
            granted: Code.items.map((Item) => ({...Item})),
            ...(Code.entitlement ? {grantedEntitlement: {...Code.entitlement}} : {}),
            refreshInventory: Code.items.length > 0
        };
    }, {behavior: "immediate"});
}
