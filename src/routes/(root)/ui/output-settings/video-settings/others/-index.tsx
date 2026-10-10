import Divider from '@/components/Divider'
import Metadata from './Metadata'
import Subtitles from './Subtitles'
import VideoOnlySection from '../VideoOnlySection'

type OthersProps = {
  mediaIndex: number
  /** Audio outputs cannot hold subtitles */
  disableSubtitles?: boolean
}

function Others({ mediaIndex, disableSubtitles }: OthersProps) {
  return (
    <div>
      <VideoOnlySection isDisabled={disableSubtitles}>
        <Subtitles mediaIndex={mediaIndex} />
      </VideoOnlySection>
      <Divider className="my-3" />
      <Metadata mediaIndex={mediaIndex} />
    </div>
  )
}

export default Others
