import Divider from '@/components/Divider'
import Metadata from './Metadata'
import Subtitles from './Subtitles'
import VideoOnlySection from '../VideoOnlySection'
import Clips from '../video/Clips'
import CustomThumbnail from '../video/CustomThumbnail'

type OthersProps = {
  mediaIndex: number
  /** Audio outputs cannot hold subtitles, clips, or thumbnails */
  disableVideoOptions?: boolean
  /** Audio files never have video options, so only their metadata is shown */
  hideVideoOptions?: boolean
}

function Others({
  mediaIndex,
  disableVideoOptions,
  hideVideoOptions,
}: OthersProps) {
  return (
    <div>
      {!hideVideoOptions ? (
        <>
          <VideoOnlySection isDisabled={disableVideoOptions}>
            <Subtitles mediaIndex={mediaIndex} />
            <Divider className="my-3" />
            <CustomThumbnail mediaIndex={mediaIndex} />
            <Divider className="my-3" />
            <Clips mediaIndex={mediaIndex} />
          </VideoOnlySection>
          <Divider className="my-3" />
        </>
      ) : null}
      <Metadata mediaIndex={mediaIndex} />
    </div>
  )
}

export default Others
