import { ballot, candidate, fiveStarCount, allocatedScoreResults, allocatedScoreSummaryData, summaryData, totalScore } from "./ITabulators";

import { IparsedData } from './ParseData'
const ParseData = require("./ParseData");
declare namespace Intl {
    class ListFormat {
        constructor(locales?: string | string[], options?: {});
        public format: (items: string[]) => string;
    }
}
// converts list of strings to string with correct grammar ([a,b,c] => 'a, b, and c')
const formatter = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const minScore = 0;
const maxScore = 5;

interface winner_scores {
    index: number
    ballot_weight: number,
    weighted_score: number
}

export function AllocatedScore(candidates: string[], votes: ballot[], nWinners = 3, breakTiesRandomly = true, enablefiveStarTiebreaker = true) {
    // Determines STAR-PR winners for given election using Allocated Score
    // Parameters: 
    // candidates: Array of candidate names
    // votes: Array of votes, size nVoters x Candidates
    // nWiners: Number of winners in election, defaulted to 3
    // breakTiesRandomly: In the event of a true tie, should a winner be selected at random, defaulted to true
    // enablefiveStarTiebreaker: In the event of a true tie in the runoff round, should the five-star tiebreaker be used (select candidate with the most 5 star votes), defaulted to true
    // Parse the votes for valid, invalid, and undervotes, and identifies bullet votes
    const parsedData: IparsedData = ParseData(votes)

    // Compress valid votes into data needed to run election including
    // total scores
    // score histograms
    // preference and pairwise matrices
    const summaryData = getSummaryData(candidates, parsedData)

    // Initialize output data structure
    const results: allocatedScoreResults = {
        elected: [],
        tied: [],
        other: [],
        roundResults: [],
        summaryData: summaryData,
    }
    var remainingCandidates = [...summaryData.candidates]
    // Run election rounds until there are no remaining candidates
    // Keep running elections rounds even if all seats have been filled to determine candidate order

    // Normalize scores array
    var scoresNorm = normalizeArray(parsedData.scores, maxScore);

    // Find number of voters and quota size
    const V = scoresNorm.length;
    const quota = V / nWinners;
    var num_candidates = candidates.length

    var ballot_weights: number[] = Array(V).fill(1);

    var ties = [];
    // var weightedSumsByRound = []
    var candidatesByRound: candidate[][] = []
    // run loop until specified number of winners are found
    while (results.elected.length < nWinners) {
        // weight the scores
        var weighted_scores: ballot[] = Array(scoresNorm.length);
        var weighted_sums: number[] = Array(num_candidates).fill(0);
        scoresNorm.forEach((ballot, b) => {
            weighted_scores[b] = [];
            ballot.forEach((score, s) => {
                weighted_scores[b][s] = score * ballot_weights[b];
                weighted_sums[s] += weighted_scores[b][s]
            });
            // sum scores for each candidate
            // weighted_sums[r] = sumArray(weighted_scores[r]);
        });
        summaryData.weightedScoresByRound.push(weighted_sums)
        candidatesByRound.push([...remainingCandidates])
        // get index of winner
        var maxAndTies = indexOfMax(weighted_sums, breakTiesRandomly);
        var w = maxAndTies.maxIndex;
        var roundTies: candidate[] = [];
        maxAndTies.ties.forEach((index, i) => {
            roundTies.push(summaryData.candidates[index]);
        });
        results.tied.push(roundTies);
        // add winner to winner list
        results.elected.push(summaryData.candidates[w]);
        // Set all scores for winner to zero
        scoresNorm.forEach((ballot, b) => {
            ballot[w] = 0
        })
        remainingCandidates = remainingCandidates.filter(c => c != summaryData.candidates[w])
        // remainingCandidates.splice(w, 1);

        // create arrays for sorting ballots
        var cand_df: winner_scores[] = [];
        var cand_df_sorted: winner_scores[] = [];

        weighted_scores.forEach((weighted_score, i) => {
            cand_df.push({
                index: i,
                ballot_weight: ballot_weights[i],
                weighted_score: weighted_score[w]
            });
            cand_df_sorted.push({
                index: i,
                ballot_weight: ballot_weights[i],
                weighted_score: weighted_score[w]
            });
        });

        cand_df_sorted.sort((a, b) =>
            a.weighted_score < b.weighted_score ? 1 : -1
        );

        var split_point = findSplitPoint(cand_df_sorted, quota);

        summaryData.splitPoints.push(split_point);

        var spent_above = 0;
        cand_df.forEach((c, i) => {
            if (c.weighted_score > split_point) {
                spent_above += c.ballot_weight;
            }
        });
        summaryData.spentAboves.push(spent_above);

        if (spent_above > 0) {
            cand_df.forEach((c, i) => {
                if (c.weighted_score > split_point) {
                    cand_df[i].ballot_weight = 0;
                }
            });
        }

        var weight_on_split = findWeightOnSplit(cand_df, split_point);

        summaryData.weight_on_splits.push(weight_on_split);
        ballot_weights = updateBallotWeights(
            cand_df,
            ballot_weights,
            weight_on_split,
            quota,
            spent_above,
            split_point
        );
    }

    for (let i = 0; i < summaryData.weightedScoresByRound.length; i++) {
        for (let j = 0; j < summaryData.weightedScoresByRound[i].length; j++) {
            summaryData.weightedScoresByRound[i][j] *= maxScore
        }
    }

    results.other = remainingCandidates;

    return results
}

function getSummaryData(candidates: string[], parsedData: IparsedData): allocatedScoreSummaryData {
    const nCandidates = candidates.length
    // Initialize summary data structures
    // Total scores for each candidate, includes candidate indexes for easier sorting
    const totalScores: totalScore[] = Array(nCandidates)
    for (let i = 0; i < nCandidates; i++) {
        totalScores[i] = { index: i, score: 0 };
    }

    // Score histograms for data analysis and five-star tiebreakers
    const scoreHist: number[][] = Array(nCandidates);
    for (let i = 0; i < nCandidates; i++) {
        scoreHist[i] = Array(6).fill(0);
    }

    // Matrix for voter preferences
    const preferenceMatrix: number[][] = Array(nCandidates);
    const pairwiseMatrix: number[][] = Array(nCandidates);
    for (let i = 0; i < nCandidates; i++) {
        preferenceMatrix[i] = Array(nCandidates).fill(0);
        pairwiseMatrix[i] = Array(nCandidates).fill(0);
    }
    let nBulletVotes = 0

    // Iterate through ballots and populate data structures
    parsedData.scores.forEach((vote) => {
        let nSupported = 0
        for (let i = 0; i < nCandidates; i++) {
            totalScores[i].score += vote[i]
            scoreHist[i][vote[i]] += 1
            for (let j = 0; j < nCandidates; j++) {
                if (i !== j) {
                    if (vote[i] > vote[j]) {
                        preferenceMatrix[i][j] += 1
                    }
                }
            }
            if (vote[i] > 0) {
                nSupported += 1
            }
        }
        if (nSupported === 1) {
            nBulletVotes += 1
        }
    })

    for (let i = 0; i < nCandidates; i++) {
        for (let j = 0; j < nCandidates; j++) {
            if (preferenceMatrix[i][j] > preferenceMatrix[j][i]) {
                pairwiseMatrix[i][j] = 1
            }
            else if (preferenceMatrix[i][j] < preferenceMatrix[j][i]) {
                pairwiseMatrix[j][i] = 1
            }

        }
    }
    const candidatesWithIndexes: candidate[] = candidates.map((candidate, index) => ({ index: index, name: candidate }))
    return {
        candidates: candidatesWithIndexes,
        totalScores,
        scoreHist,
        preferenceMatrix,
        pairwiseMatrix,
        nValidVotes: parsedData.validVotes.length,
        nInvalidVotes: parsedData.invalidVotes.length,
        nUnderVotes: parsedData.underVotes,
        nBulletVotes: nBulletVotes,
        splitPoints: [],
        spentAboves: [],
        weight_on_splits: [],
        weightedScoresByRound: []
    }
}

function sortData(summaryData: allocatedScoreSummaryData, order: candidate[]): allocatedScoreSummaryData {
    // sorts summary data to be in specified order
    const indexOrder = order.map(c => c.index)
    const candidates = indexOrder.map(ind => (summaryData.candidates[ind]))
    candidates.forEach((c, i) => {
        c.index = i
    })
    const totalScores = indexOrder.map((ind, i) => ({ index: i, score: summaryData.totalScores[ind].score }))
    const scoreHist = indexOrder.map((ind) => summaryData.scoreHist[ind])
    const preferenceMatrix = sortMatrix(summaryData.preferenceMatrix, indexOrder)
    const pairwiseMatrix = sortMatrix(summaryData.pairwiseMatrix, indexOrder)
    return {
        candidates,
        totalScores,
        scoreHist,
        preferenceMatrix,
        pairwiseMatrix,
        nValidVotes: summaryData.nValidVotes,
        nInvalidVotes: summaryData.nInvalidVotes,
        nUnderVotes: summaryData.nUnderVotes,
        nBulletVotes: summaryData.nBulletVotes,
        splitPoints: summaryData.splitPoints,
        spentAboves: summaryData.spentAboves,
        weight_on_splits: summaryData.weight_on_splits,
        weightedScoresByRound: summaryData.weightedScoresByRound,
    }
}

function updateBallotWeights(
    cand_df: winner_scores[],
    ballot_weights: number[],
    weight_on_split: number,
    quota: number,
    spent_above: number,
    split_point: number
) {
    if (weight_on_split > 0) {
        var spent_value = (quota - spent_above) / weight_on_split;
        cand_df.forEach((c, i) => {
            if (c.weighted_score === split_point) {
                cand_df[i].ballot_weight = cand_df[i].ballot_weight * (1 - spent_value);
            }
        });
    }
    cand_df.forEach((c, i) => {
        if (c.ballot_weight > 1) {
            ballot_weights[i] = 1;
        } else if (c.ballot_weight < 0) {
            ballot_weights[i] = 0;
        } else {
            ballot_weights[i] = c.ballot_weight;
        }
    });

    return ballot_weights;
}

function findWeightOnSplit(cand_df: winner_scores[], split_point: number) {
    var weight_on_split = 0;
    cand_df.forEach((c, i) => {
        if (c.weighted_score === split_point) {
            weight_on_split += c.ballot_weight;
        }
    });
    return weight_on_split;
}

function indexOfMax(arr: number[], breakTiesRandomly: boolean) {
    if (arr.length === 0) {
        return { maxIndex: -1, ties: [] };
    }

    var max = arr[0];
    var maxIndex = 0;
    var ties: number[] = [0];
    for (var i = 1; i < arr.length; i++) {
        if (arr[i] > max) {
            maxIndex = i;
            max = arr[i];
            ties = [i];
        } else if (arr[i] === max) {
            ties.push(i);
        }
    }
    if (breakTiesRandomly && ties.length > 1) {
        maxIndex = ties[getRandomInt(ties.length)]
    }
    return { maxIndex, ties };
}

function getRandomInt(max: number) {
    return Math.floor(Math.random() * max);
}

function normalizeArray(scores: ballot[], maxScore: number) {
    // Normalize scores array
    var scoresNorm: ballot[] = Array(scores.length);
    scores.forEach((row, r) => {
        scoresNorm[r] = [];
        row.forEach((score, s) => {
            scoresNorm[r][s] = score / maxScore;
        });
    });
    return scoresNorm;
}

function findSplitPoint(cand_df_sorted: winner_scores[], quota: number) {
    var under_quota = [];
    var under_quota_scores: number[] = [];
    var cumsum = 0;
    cand_df_sorted.forEach((c, i) => {
        cumsum += c.ballot_weight;
        if (cumsum < quota) {
            under_quota.push(c);
            under_quota_scores.push(c.weighted_score);
        }
    });
    return Math.min(...under_quota_scores);
}

function sortMatrix(matrix: number[][], order: number[]) {
    var newMatrix: number[][] = Array(order.length);
    for (let i = 0; i < order.length; i++) {
        newMatrix[i] = Array(order.length).fill(0);
    }
    order.forEach((i, iInd) => {
        order.forEach((j, jInd) => {
            newMatrix[iInd][jInd] = matrix[i][j];
        });
    });
    return newMatrix
}