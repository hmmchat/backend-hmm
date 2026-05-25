import test from "node:test";
import assert from "node:assert/strict";
import { MEET_RN_WAITING_MESSAGES } from "../src/config/meet-rn-waiting-messages.config.js";
import { MeetRnWaitingMessageService } from "../src/services/meet-rn-waiting-message.service.js";

test("getRandomMessage falls back to configured messages when database is empty", async () => {
  const prisma = {
    meetRnWaitingMessage: {
      findMany: async () => []
    }
  };

  const service = new MeetRnWaitingMessageService(prisma as any);
  const message = await service.getRandomMessage();
  assert.ok(MEET_RN_WAITING_MESSAGES.includes(message as typeof MEET_RN_WAITING_MESSAGES[number]));
});

test("getRandomMessage returns an active database message when available", async () => {
  const prisma = {
    meetRnWaitingMessage: {
      findMany: async () => [{ text: "Custom dashboard copy" }]
    }
  };

  const service = new MeetRnWaitingMessageService(prisma as any);
  const message = await service.getRandomMessage();
  assert.equal(message, "Custom dashboard copy");
});
