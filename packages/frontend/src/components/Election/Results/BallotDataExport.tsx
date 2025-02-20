import { CSVLink, CSVDownload } from 'react-csv';
import { useState, useEffect } from 'react';
import { Election } from '@equal-vote/star-vote-shared/domain_model/Election';
import MenuItem from "@mui/material/MenuItem";
import BorderAll from '@mui/icons-material/BorderAll';
import DataObject from '@mui/icons-material/DataObject';
import { MenuButton } from '~/components/MenuButton';
import useAnonymizedBallots from '~/components/AnonymizedBallotsContextProvider';

interface Props {
    election: Election;
}

export const BallotDataExport = ({ election }: Props) => {
    const [csvData, setCsvData] = useState<any[]>([]);
    const [csvHeaders, setCsvHeaders] = useState<any[]>([]);
    const { ballots, fetchBallots } = useAnonymizedBallots();
    const downloadCSV = async () => {
        if (!ballots) return
        let header = [
            { label: 'ballot_id', key: 'ballot_id' },
            { label: 'precinct', key: 'precinct' },
            ...election.races.map((race) =>
                race.candidates.map((c) => ({
                    label: `${race.title}!!${c.candidate_name}`,
                    key: `${race.race_id}-${c.candidate_id}`,
                }))
            ),
        ];
        header = header.flat();
        let tempCsvData = ballots.map((ballot) => {
            let row = { ballot_id: ballot.ballot_id, precinct: ballot.precinct };
            ballot.votes.forEach((vote) =>
                vote.scores.forEach((score) => {
                    row[`${vote.race_id}-${score.candidate_id}`] = score.score;
                })
            );
            return row;
        });
        setCsvData(tempCsvData);
        setCsvHeaders(header);
        document.getElementById('csv-download-link')?.click();

    };

    const limit = (string = '', limit = 0) => {
        if (!string) return '';
        return string.substring(0, limit);
    };
    const downloadJson = async () => {
        const ballotObject = { Election: election, Ballots: ballots };
        const ballotJson = JSON.stringify(ballotObject, null, 2);
        const blob = new Blob([ballotJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Ballot Data - ${limit(election.title, 50)}-${election.election_id}.json`;
        a.click();
    }
    return (
            <>
                <a onClick={fetchBallots}>
                    <MenuButton label={"Download"} >
                        {ballots && <>
                            <MenuItem key="csv"  id={"download-csv"} onClick={downloadCSV}>
                                <BorderAll sx={{ marginRight: 1 }} />
                                Download CSV
                            </MenuItem>
                            <MenuItem key="json" onClick={downloadJson}>
                                <DataObject sx={{ marginRight: 1 }} />
                                Download JSON
                            </MenuItem>
                        </>}
                        {!ballots && 
                            <MenuItem disabled>Loading Ballots...</MenuItem>
                        }
                    </MenuButton>
                </a>
                
                {csvData.length > 0 && (
                    //For some reason, CSVDownload doesn't allow you to set the filename, so we use CSVLink instead,
                    //but we hide it so it doesn't show up on the page.
                    //I couldn't get it work clicking on CSVLink directly because the download was starting before the state was set.
                    //This makes sure the download only starts when the state is set.
                    <CSVLink
                    id="csv-download-link"
                    data={csvData}
                    headers={csvHeaders}
                    
                    target="_blank"
                    filename={`Ballot Data - ${limit(election.title, 50)}-${election.election_id}.csv`}
                    enclosingCharacter={``}
                    style={{ display: 'none' }}
                />
                    )}
            </>
    );
};