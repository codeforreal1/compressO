import Divider from '@/components/Divider'
import Metadata from './Metadata'
import Subtitles from './Subtitles'
import VideoOnlySection from '../VideoOnlySection'

type OthersProps = {
  mediaIndex: number
  /** Audio outputs cannot hold subtitles */
  disableSubtitles?: boolean
  /** Audio files never have subtitles, so only their metadata is shown */
  hideSubtitles?: boolean
}

function Others({ mediaIndex, disableSubtitles, hideSubtitles }: OthersProps) {
  return (
    <div>
      {!hideSubtitles ? (
        <>
          <VideoOnlySection isDisabled={disableSubtitles}>
            <Subtitles mediaIndex={mediaIndex} />
          </VideoOnlySection>
          <Divider className="my-3" />
        </>
      ) : null}
      <Metadata mediaIndex={mediaIndex} />
    </div>
  )
}

export default Others
