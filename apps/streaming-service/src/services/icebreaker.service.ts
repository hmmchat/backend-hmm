import { Injectable, Logger } from "@nestjs/common";

// List of icebreaker questions
const ICEBREAKER_LIST = [
  "What's your favorite movie of the year?",
  "What's the best book you've read recently?",
  "What's your go-to comfort food?",
  "What's your dream vacation destination?",
  "What's a skill you'd like to learn?",
  "What's your favorite way to spend a weekend?",
  "What's the most interesting place you've visited?",
  "What's a hobby you're passionate about?",
  "What's your favorite type of music?",
  "What's something on your bucket list?",
  "What's the best piece of advice you've received?",
  "What's your favorite season and why?",
  "What's a TV show you're currently watching?",
  "What's your favorite childhood memory?",
  "What's something that always makes you smile?",
  "What's your favorite way to exercise?",
  "What's a goal you're working towards?",
  "What's your favorite type of cuisine?",
  "What's something you're grateful for today?",
  "What's your favorite way to relax?",
  "What's the most adventurous thing you've done?",
  "What's your favorite holiday and why?",
  "What's a talent you have that surprises people?",
  "What's your favorite type of weather?",
  "What's something you've always wanted to try?",
  "What's your favorite way to start your day?",
  "What's a movie you could watch over and over?",
  "What's your favorite social media platform?",
  "What's something that motivates you?",
  "What's your favorite way to end your day?"
];

@Injectable()
export class IcebreakerService {
  private readonly logger = new Logger(IcebreakerService.name);

  /**
   * Get a random icebreaker question
   */
  getRandomIcebreaker(): string {
    const randomIndex = Math.floor(Math.random() * ICEBREAKER_LIST.length);
    const icebreaker = ICEBREAKER_LIST[randomIndex];
    this.logger.debug(`Generated random icebreaker: ${icebreaker}`);
    return icebreaker;
  }

  /**
   * Get all icebreakers (for testing/admin purposes)
   */
  getAllIcebreakers(): string[] {
    return [...ICEBREAKER_LIST];
  }
}

