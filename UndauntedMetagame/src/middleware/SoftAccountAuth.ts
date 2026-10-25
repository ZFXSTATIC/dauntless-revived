import { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { JwtPayload } from "jsonwebtoken";
import { GetDb } from "../db";
import { users } from "../db/schema";
import { ValidateMetagameJWTAndGetPayload } from "../controllers/auth";
import { GetUserInfoForApiKey } from "../controllers/undauntedapi";

// For routes that answer everyone but tell registered players more (GET /undaunted/api/ServerStatus:
// the live player list is for registered players only). The caller counts as a registered player
// with either
// - an account key in x-undaunted-user-api-key, checked exactly like GetUserInfo (the hashed-key
//   lookup, compared in constant time), admin or not, or
// - a valid player bearer token whose account still exists.
// Anything else (no key, a wrong key, an expired token, a deleted account) leaves the request
// anonymous and the route answers its public reply. Never a 401: a launcher that has not
// registered yet still reads the server's name and registration mode. The key is never logged,
// stored or cached here.

const MAX_KEY_LENGTH = 1024;

async function AccountKeyUserId(req: Request): Promise<string | undefined>{
    const Key = req.headers["x-undaunted-user-api-key"];

    if(typeof Key !== "string" || Key.length === 0 || Key.length > MAX_KEY_LENGTH){
        return undefined;
    }

    try{
        return (await GetUserInfoForApiKey(Key))?.UserId;
    }
    catch{
        return undefined; // an unsupported AUTH_MODE or a database error: answer as for no key
    }
}

function PlayerTokenUserId(req: Request): string | undefined{
    const AuthHeader = req.headers.authorization;

    if(typeof AuthHeader !== "string" || !/^bearer /i.test(AuthHeader)){
        return undefined;
    }

    try{
        const Payload = ValidateMetagameJWTAndGetPayload(AuthHeader.slice("bearer ".length)) as JwtPayload;
        const UserId = Payload?.userId;

        if(typeof UserId !== "string" || UserId.length === 0){
            return undefined;
        }

        return GetDb().select({ userId: users.userId }).from(users).where(eq(users.userId, UserId)).get()?.userId;
    }
    catch{
        return undefined;
    }
}

export async function RegisteredCallerUserId(req: Request){
    return await AccountKeyUserId(req) ?? PlayerTokenUserId(req);
}

export async function IsRegisteredCaller(req: Request){
    return await RegisteredCallerUserId(req) !== undefined;
}

export async function SoftAccountAuth(req: Request, res: Response, next: NextFunction){
    const UserId = await RegisteredCallerUserId(req);

    (req as any).RegisteredCaller = UserId !== undefined;
    (req as any).RegisteredCallerUserId = UserId;

    next();
}

export function IsSoftRegisteredCaller(req: Request){
    return (req as any).RegisteredCaller === true;
}

// The account of a registered caller (undefined for an anonymous one)
export function SoftCallerUserId(req: Request): string | undefined{
    const UserId = (req as any).RegisteredCallerUserId;

    return typeof UserId === "string" ? UserId : undefined;
}
